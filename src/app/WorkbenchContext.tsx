import {
  createContext,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react'
import { useStore } from 'zustand'
import { browserScheduler } from '../domain/simulator.ts'
import type { CommandSource } from '../domain/types.ts'
import { createInitialState } from '../domain/initialState.ts'
import {
  createWorkbench,
  type Workbench,
  type WorkbenchSnapshot,
} from '../domain/workbench.ts'
import { deriveStageStates } from '../domain/workflow.ts'
import { createScriptedAgent } from './agent/scriptedAgent.ts'
import type { AgentAdapter, AgentSnapshot } from './agent/types.ts'
import {
  APPEARANCES,
  resolveAppearance,
  type Appearance,
  type AppearancePreference,
} from './appearance/appearances.ts'
import {
  createLayoutController,
  type LayoutController,
} from './layout/layoutController.ts'
import { initialConditions } from '../server/conditions.ts'
import { FIXTURES } from '../server/fixtures.ts'
import { hasOutdatedProject } from '../server/persistence.ts'
import { createMockServer } from '../server/server.ts'
import { createTransport } from '../server/transport.ts'
import {
  readBasemapPreference,
  storeBasemapPreference,
} from './basemapPreference.ts'
import {
  DRAFT_COMMANDS,
  createProjectClient,
  refuseServerCommand,
  type ClientSnapshot,
  type ProjectClient,
} from './service/projectClient.ts'
import { getBrowserStorage, getSessionStorage } from './storage.ts'
import {
  applyAppearance,
  readAppearancePreference,
  storeAppearancePreference,
} from './theme.ts'
import type { ViewState } from './view/viewOperations.ts'
import { createViewStore, type ViewStore } from './view/viewStore.ts'
import {
  createProjectLifecycle,
  type ProjectLifecycle,
} from './service/projectLifecycle.ts'

type CoreServices = {
  storage: Storage | null
  /** The UI's copy of the project; server commands go through `client`. */
  workbench: Workbench
  /** Sends server commands to the mock server and follows its updates (decision 0023). */
  client: ProjectClient
  lifecycle: ProjectLifecycle
  layout: LayoutController
  /** Logged view state shared by manual controls and the agent. */
  view: ViewStore
  /** The scripted agent behind the adapter a model provider can replace. */
  agent: AgentAdapter
}

/**
 * The surface the user is working in, used by Inspection when nothing is
 * selected. Deliberately ephemeral: focus changes on every click, and logging
 * them would bury the operation log (decision 0018).
 */
export type WorkedSurface = 'map' | null

export type Services = CoreServices & {
  /** The stored choice, which may be "system". */
  appearancePreference: AppearancePreference
  /** The appearance actually shown. */
  appearance: Appearance
  setAppearance: (preference: AppearancePreference) => void
  /** Whether the Map page shows the OpenFreeMap basemap (decision 0012). */
  basemapEnabled: boolean
  setBasemapEnabled: (enabled: boolean) => void
  /** Opens the Inspection panel, which follows the shared selection. */
  showInspection: (source?: CommandSource) => void
  /** The surface being worked in; Inspection shows its properties when nothing is selected. */
  workedSurface: WorkedSurface
  claimWorked: (surface: 'map') => void
}

const ServicesContext = createContext<Services | null>(null)

const DARK_QUERY = '(prefers-color-scheme: dark)'

function systemPrefersDark(): boolean {
  return (
    typeof window.matchMedia === 'function' &&
    window.matchMedia(DARK_QUERY).matches
  )
}

function createCoreServices(): CoreServices {
  const storage = getBrowserStorage()
  const session = getSessionStorage()
  const { conditions, fixture } = initialConditions(
    session,
    window.location.search,
  )
  const server = createMockServer({
    storage,
    scheduler: browserScheduler,
    fixture,
    startClosed: true,
  })
  const transport = createTransport(server, {
    scheduler: browserScheduler,
    conditions,
  })
  const initial = server.current()
  const workbench = createWorkbench({
    operationIdPrefix: 'ui-op',
    initialState: initial.state ?? createInitialState(),
    isUndoable: (type) => DRAFT_COMMANDS.has(type),
    refuse: (type) =>
      refuseServerCommand(
        type,
        client.store.getState().pending,
        client.store.getState().meta.currentProject !== null,
        client.store.getState().transitioning,
      ),
  })
  const client = createProjectClient({ workbench, transport, session, initial })
  if (fixture) {
    workbench.record({
      type: 'project.replace',
      title: 'Load fixture',
      input: { fixture },
      summary: `Loaded the "${FIXTURES[fixture].label}" fixture from the page address: ${FIXTURES[fixture].description}`,
      source: 'system',
    })
  } else if (initial.meta.savedAt) {
    workbench.record({
      type: 'project.restore',
      title: 'Restore saved project',
      summary: `Restored the project saved in this browser at ${new Date(initial.meta.savedAt).toLocaleString()}.`,
      source: 'system',
    })
  } else if (hasOutdatedProject(storage)) {
    workbench.record({
      type: 'project.restore',
      title: 'Restore saved project',
      summary:
        'A project saved before the Back Bay footprints was not restored because its buildings no longer match the map. Run the workflow again to rebuild it.',
      source: 'system',
    })
  }
  const layout = createLayoutController(workbench, storage)
  const view = createViewStore(workbench)
  const lifecycle = createProjectLifecycle({ workbench, client })
  const agent = createScriptedAgent({
    workbench,
    client,
    lifecycle,
    layout,
    view,
    scheduler: browserScheduler,
  })
  client.store.subscribe((snapshot, previous) => {
    if (snapshot.projectGeneration !== previous.projectGeneration) {
      agent.resetForProject()
      view.execute({ type: 'view.resetForProject', input: {} }, 'system')
    }
  })
  return {
    storage,
    workbench,
    client,
    lifecycle,
    layout,
    view,
    agent,
  }
}

export function WorkbenchProvider({ children }: { children: ReactNode }) {
  const [core] = useState(createCoreServices)
  const [appearancePreference, setAppearancePreference] = useState(() =>
    readAppearancePreference(core.storage),
  )
  const [systemDark, setSystemDark] = useState(systemPrefersDark)
  const [basemapEnabled, setBasemapEnabledState] = useState(() =>
    readBasemapPreference(core.storage),
  )
  const appearance = resolveAppearance(appearancePreference, systemDark)
  const generation = useStore(
    core.client.store,
    (snapshot) => snapshot.projectGeneration,
  )
  const [worked, setWorked] = useState<{
    generation: number
    surface: WorkedSurface
  }>({ generation, surface: null })
  const workedSurface = worked.generation === generation ? worked.surface : null

  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return
    const query = window.matchMedia(DARK_QUERY)
    const update = () => setSystemDark(query.matches)
    query.addEventListener('change', update)
    return () => query.removeEventListener('change', update)
  }, [])

  // Apply before paint so the first frame already shows the chosen appearance.
  useLayoutEffect(() => {
    applyAppearance(appearance)
  }, [appearance])

  const services = useMemo<Services>(() => {
    return {
      ...core,
      appearancePreference,
      appearance,
      setAppearance: (next) => {
        setAppearancePreference(next)
        storeAppearancePreference(core.storage, next)
        core.workbench.record({
          type: 'view.setAppearance',
          title: 'Set appearance',
          input: { appearance: next },
          summary:
            next === 'system'
              ? 'Appearance follows the system light or dark setting.'
              : `Appearance set to ${APPEARANCES[next].label}.`,
        })
      },
      basemapEnabled,
      setBasemapEnabled: (enabled) => {
        setBasemapEnabledState(enabled)
        storeBasemapPreference(core.storage, enabled)
        core.workbench.record({
          type: 'view.setBasemap',
          title: 'Show or hide basemap',
          input: { enabled },
          summary: enabled
            ? 'The Map shows the OpenFreeMap basemap.'
            : 'The Map shows footprints on a plain background.',
        })
      },
      showInspection: (source = 'manual') => {
        if (!core.layout.isPanelOpen('inspection')) {
          core.layout.togglePanel('inspection', source)
        }
      },
      workedSurface,
      claimWorked: (surface) => setWorked({ generation, surface }),
    }
  }, [
    core,
    appearancePreference,
    appearance,
    basemapEnabled,
    workedSurface,
    generation,
  ])

  return (
    <ServicesContext.Provider value={services}>
      {children}
    </ServicesContext.Provider>
  )
}

export function useServices(): Services {
  const services = useContext(ServicesContext)
  if (!services) {
    throw new Error('useServices must be used inside WorkbenchProvider')
  }
  return services
}

/** The appearance actually shown, including its data palette for canvas renderers. */
export function useAppearance(): Appearance {
  return useServices().appearance
}

export function useWorkbenchSnapshot<T>(
  selector: (snapshot: WorkbenchSnapshot) => T,
): T {
  return useStore(useServices().workbench.store, selector)
}

/** Reads requests in flight, the server's save state, and the demo conditions. */
export function useClientSnapshot<T>(
  selector: (snapshot: ClientSnapshot) => T,
): T {
  return useStore(useServices().client.store, selector)
}

/** Reads logged view state (map, table, dashboard). */
export function useViewState<T>(selector: (view: ViewState) => T): T {
  return useStore(useServices().view.store, selector)
}

/** Reads the agent's status, transcript, and prepared sessions. */
export function useAgentSnapshot<T>(
  selector: (snapshot: AgentSnapshot) => T,
): T {
  return useStore(useServices().agent.store, selector)
}

export function useStageStates() {
  const workflow = useWorkbenchSnapshot((snapshot) => snapshot.state.workflow)
  const tasks = useWorkbenchSnapshot((snapshot) => snapshot.state.tasks)
  return useMemo(() => deriveStageStates(workflow, tasks), [workflow, tasks])
}

/** Re-renders the caller whenever the FlexLayout model changes. */
export function useLayoutVersion(): number {
  const { layout } = useServices()
  return useSyncExternalStore(layout.subscribe, layout.getVersion)
}
