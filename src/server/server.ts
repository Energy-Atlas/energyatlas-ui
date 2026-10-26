import type { Command } from '../domain/commands.ts'
import { createInitialState } from '../domain/initialState.ts'
import {
  startTaskSimulator,
  type JobBehaviour,
  type Scheduler,
} from '../domain/simulator.ts'
import type {
  CommandSource,
  PendingEdit,
  WorkbenchState,
} from '../domain/types.ts'
import { createWorkbench, type ExternalOperation } from '../domain/workbench.ts'
import {
  invalidRequest,
  runInProgress,
  serverError,
  type ApiFailure,
} from './apiError.ts'
import { FIXTURES, buildFixture, type FixtureId } from './fixtures.ts'
import { loadProject, saveProject } from './persistence.ts'

// The mock server (decision 0023). It owns the project and runs the domain
// engine, as RC's EnergyAtlasWeb will; the UI reaches it only through the
// transport. It restarts with every page load and restores the saved project.

/** Commands the server owns; everything else is local UI state. */
export const SERVER_COMMANDS: ReadonlySet<Command['type']> = new Set([
  'workflow.runStage',
  'workflow.setStageSkipped',
  'workflow.insertStage',
  'task.cancel',
  'edits.apply',
  'measure.create',
  'scenario.create',
  'scenario.setAdoption',
])

/** Server commands that change the project model, refused while a run holds it. */
export const MODEL_COMMANDS: ReadonlySet<Command['type']> = new Set([
  'workflow.setStageSkipped',
  'workflow.insertStage',
  'edits.apply',
  'measure.create',
  'scenario.create',
  'scenario.setAdoption',
])

export type ServerRequest =
  | {
      type: 'command'
      command: Command
      source: CommandSource
      /** The drafts to apply, for `edits.apply`; drafts live in the UI. */
      drafts?: Record<string, PendingEdit>
    }
  | { type: 'project.save'; source: CommandSource }
  | { type: 'project.replace'; fixture: FixtureId; source: CommandSource }

export type ServerMeta = {
  /** The project differs from the copy saved in this browser. */
  dirty: boolean
  savedAt: string | null
}

/** Everything the UI needs to follow the server: state, what changed it, and meta. */
export type ServerUpdate = {
  sequence: number
  state: WorkbenchState
  operations: ExternalOperation[]
  meta: ServerMeta
}

export type ServerReply =
  { ok: true; summary: string; sequence: number } | ({ ok: false } & ApiFailure)

export type MockServer = {
  handle: (request: ServerRequest) => ServerReply
  /** The latest state, for a client starting or catching up after being offline. */
  current: () => ServerUpdate
  subscribe: (listener: (update: ServerUpdate) => void) => () => void
  setJobBehaviour: (behaviour: JobBehaviour) => void
  dispose: () => void
}

/** Draft-only types never leave the server's engine; the UI keeps its own. */
const DRAFT_TYPES = new Set(['edits.propose', 'edits.discard'])

export function createMockServer(options: {
  storage: Storage | null
  scheduler: Scheduler
  now?: () => Date
  /** Starts from this fixture instead of the saved project. */
  fixture?: FixtureId | null
}): MockServer {
  const now = options.now ?? (() => new Date())
  const saved = options.fixture ? null : loadProject(options.storage)
  const engine = createWorkbench({
    initialState: options.fixture
      ? buildFixture(options.fixture, now)
      : (saved?.state ?? createInitialState()),
    now,
  })
  let meta: ServerMeta = {
    dirty: Boolean(options.fixture),
    savedAt: saved?.savedAt ?? null,
  }
  let sequence = 0
  let forwarded = engine.store.getState().log.length
  let jobBehaviour: JobBehaviour = 'normal'
  const listeners = new Set<(update: ServerUpdate) => void>()

  function emit(operations: ExternalOperation[]) {
    sequence += 1
    const update: ServerUpdate = {
      sequence,
      state: engine.getState(),
      operations,
      meta,
    }
    for (const listener of listeners) listener(update)
  }

  /** Forwards the engine's new applied operations, as hubs push events. */
  function forward() {
    const log = engine.store.getState().log
    const fresh = log.slice(forwarded)
    forwarded = log.length
    const operations = fresh
      .filter(
        (entry) => entry.status === 'applied' && !DRAFT_TYPES.has(entry.type),
      )
      .map((entry): ExternalOperation => ({
        type: entry.type,
        title: entry.title,
        input: entry.input,
        source: entry.source,
        status: entry.status,
        summary: entry.summary ?? '',
        issues: entry.issues,
      }))
    if (operations.length === 0) return
    if (operations.some((operation) => operation.type !== 'project.save')) {
      meta = { ...meta, dirty: true }
    }
    emit(operations)
  }

  const unsubscribe = engine.store.subscribe(forward)
  const stopJobs = startTaskSimulator(engine, {
    scheduler: options.scheduler,
    behaviour: () => jobBehaviour,
  })

  function activeTaskId(): string | null {
    const state = engine.getState()
    return (
      state.taskIds.find((id) => {
        const status = state.tasks[id]?.status
        return status === 'queued' || status === 'running'
      }) ?? null
    )
  }

  function handleCommand(
    request: Extract<ServerRequest, { type: 'command' }>,
  ): ServerReply {
    const { command, source } = request
    if (!SERVER_COMMANDS.has(command.type)) {
      return {
        ok: false,
        ...serverError(
          `"${command.type}" is not a server request; the UI handles it.`,
          400,
        ),
      }
    }
    if (MODEL_COMMANDS.has(command.type)) {
      const running = activeTaskId()
      if (running) return { ok: false, ...runInProgress(running, 'stage') }
    }
    if (command.type === 'edits.apply') {
      engine.adopt(
        { ...engine.getState(), pendingEdits: request.drafts ?? {} },
        [],
      )
    }
    const { outcome } = engine.execute(command, source)
    if (command.type === 'edits.apply') {
      // Drafts that were not applied stay in the UI, not on the server.
      engine.adopt({ ...engine.getState(), pendingEdits: {} }, [])
    }
    if (outcome.status === 'rejected') {
      return { ok: false, ...invalidRequest(outcome.issues) }
    }
    return { ok: true, summary: outcome.summary, sequence }
  }

  return {
    handle(request) {
      switch (request.type) {
        case 'command':
          return handleCommand(request)
        case 'project.save': {
          const result = saveProject(options.storage, engine.getState(), now())
          if (!result.ok) {
            return { ok: false, ...serverError(result.message, 503) }
          }
          meta = { dirty: false, savedAt: result.savedAt }
          const summary = `Saved the project in this browser at ${new Date(result.savedAt).toLocaleTimeString()}.`
          engine.record({
            type: 'project.save',
            title: 'Save project',
            source: request.source,
            summary,
          })
          return { ok: true, summary, sequence }
        }
        case 'project.replace': {
          const fixture = FIXTURES[request.fixture]
          const summary =
            request.fixture === 'new'
              ? 'Started a new empty synthetic project. The copy saved in this browser is unchanged until you save.'
              : `Loaded the "${fixture.label}" fixture: ${fixture.description} The copy saved in this browser is unchanged until you save.`
          engine.load(buildFixture(request.fixture, now), {
            type: 'project.replace',
            title: request.fixture === 'new' ? 'New project' : 'Load fixture',
            input: { fixture: request.fixture },
            source: request.source,
            summary,
          })
          return { ok: true, summary, sequence }
        }
      }
    },
    current: () => ({
      sequence,
      state: engine.getState(),
      operations: [],
      meta,
    }),
    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    setJobBehaviour(behaviour) {
      jobBehaviour = behaviour
    },
    dispose() {
      stopJobs()
      unsubscribe()
      listeners.clear()
    },
  }
}
