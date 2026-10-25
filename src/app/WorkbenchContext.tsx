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
import { browserScheduler, startTaskSimulator } from '../domain/simulator.ts'
import type { CommandSource } from '../domain/types.ts'
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
import { hasOutdatedProject, loadProject } from './persistence.ts'
import {
  readBasemapPreference,
  storeBasemapPreference,
} from './basemapPreference.ts'
import { getBrowserStorage } from './storage.ts'
import {
  applyAppearance,
  readAppearancePreference,
  storeAppearancePreference,
} from './theme.ts'
import type { ViewState } from './view/viewOperations.ts'
import { createViewStore, type ViewStore } from './view/viewStore.ts'

type CoreServices = {
  storage: Storage | null
  workbench: Workbench
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
  const saved = loadProject(storage)
  const workbench = createWorkbench({ initialState: saved?.state })
  if (saved) {
    workbench.record({
      type: 'project.restore',
      title: 'Restore saved project',
      summary: `Restored the project saved in this browser at ${new Date(saved.savedAt).toLocaleString()}.`,
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
  return {
    storage,
    workbench,
    layout,
    view,
    agent: createScriptedAgent({
      workbench,
      layout,
      view,
      scheduler: browserScheduler,
    }),
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
  const [workedSurface, setWorkedSurface] = useState<WorkedSurface>(null)

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

  useEffect(
    () => startTaskSimulator(core.workbench, { scheduler: browserScheduler }),
    [core.workbench],
  )

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
      claimWorked: (surface) => setWorkedSurface(surface),
    }
  }, [core, appearancePreference, appearance, basemapEnabled, workedSurface])

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
