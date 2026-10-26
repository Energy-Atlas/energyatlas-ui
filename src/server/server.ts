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
import { projectNameSchema } from './projectValidation.ts'
import {
  projectSummaries,
  readProjectCatalog,
  restoreProject,
  writeProjectCatalog,
  type ProjectSummary,
} from './projectCatalog.ts'

// The mock server (decision 0023). It owns the project and runs the domain
// engine, as RC's EnergyAtlasWeb will; the UI reaches it only through the
// transport. It restarts with every page load and restores the saved project.

/** Commands the server owns; everything else is local UI state. */
export const SERVER_COMMANDS: ReadonlySet<Command['type']> = new Set([
  'workflow.runStage',
  'job.retry',
  'intake.applyDataset',
  'archetype.save',
  'archetype.addFromLibrary',
  'schedule.save',
  'measure.update',
  'measure.addFromLibrary',
  'scenario.update',
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
  'archetype.save',
  'archetype.addFromLibrary',
  'schedule.save',
  'measure.update',
  'measure.addFromLibrary',
  'scenario.update',
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
  | { type: 'project.list'; source: CommandSource }
  | { type: 'project.create'; name: string; source: CommandSource }
  | { type: 'project.open'; projectId: string; source: CommandSource }
  | { type: 'project.close'; source: CommandSource }

export type ServerMeta = {
  /** The project differs from the copy saved in this browser. */
  dirty: boolean
  savedAt: string | null
  currentProject: { id: string; name: string } | null
  projects: ProjectSummary[]
  catalogReady: boolean
  catalogError: string | null
}

/** Everything the UI needs to follow the server: state, what changed it, and meta. */
export type ServerUpdate = {
  sequence: number
  projectGeneration: number
  state: WorkbenchState | null
  operations: ExternalOperation[]
  meta: ServerMeta
}

export type ServerReply =
  | { ok: true; summary: string; sequence: number; projectGeneration: number }
  | ({ ok: false } & ApiFailure)

export type MockServer = {
  handle: (request: ServerRequest, expectedGeneration?: number) => ServerReply
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
  startClosed?: boolean
}): MockServer {
  const now = options.now ?? (() => new Date())
  const read = readProjectCatalog(options.storage)
  let catalog = read.catalog
  const saved =
    options.fixture || options.startClosed ? null : catalog.projects[0]
  const initialState = options.fixture
    ? buildFixture(options.fixture, now)
    : saved
      ? restoreProject(saved)
      : createInitialState()
  const startsOpen = Boolean(options.fixture) || !options.startClosed
  if (options.fixture)
    initialState.project = {
      ...initialState.project,
      id: `project:${crypto.randomUUID()}`,
    }
  const engine = createWorkbench({
    operationIdPrefix: `server-${crypto.randomUUID()}-op`,
    initialState,
    now,
  })
  let meta: ServerMeta = {
    dirty: Boolean(options.fixture),
    savedAt: saved?.savedAt ?? null,
    currentProject: startsOpen
      ? { id: initialState.project.id, name: initialState.project.name }
      : null,
    projects: projectSummaries(catalog),
    catalogReady: !options.startClosed,
    catalogError: read.error,
  }
  let sequence = 0
  let projectGeneration = 0
  let forwarded = engine.store.getState().log.length
  let jobBehaviour: JobBehaviour = 'normal'
  const listeners = new Set<(update: ServerUpdate) => void>()

  function emit(operations: ExternalOperation[]) {
    sequence += 1
    const update: ServerUpdate = {
      sequence,
      projectGeneration,
      state: meta.currentProject ? engine.getState() : null,
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
        id: entry.id,
        type: entry.type,
        title: entry.title,
        input: entry.input,
        source: entry.source,
        status: entry.status,
        summary: entry.summary ?? '',
        issues: entry.issues,
      }))
    if (operations.length === 0) return
    if (
      operations.some(
        (operation) =>
          ![
            'project.save',
            'project.list',
            'project.open',
            'project.close',
          ].includes(operation.type),
      )
    ) {
      meta = { ...meta, dirty: true }
    }
    emit(operations)
  }

  const unsubscribe = engine.store.subscribe(forward)
  let stopJobs = startTaskSimulator(engine, {
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
    if (!meta.currentProject)
      return {
        ok: false,
        ...serverError('Open or create a project first.', 409),
      }
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
    return { ok: true, summary: outcome.summary, sequence, projectGeneration }
  }

  function replaceSession(
    state: WorkbenchState | null,
    operation: ExternalOperation,
    savedAt: string | null,
  ) {
    stopJobs()
    projectGeneration += 1
    meta = {
      ...meta,
      currentProject: state
        ? { id: state.project.id, name: state.project.name }
        : null,
      savedAt,
      dirty: false,
      projects: projectSummaries(catalog),
    }
    engine.load(state ?? createInitialState(), operation)
    stopJobs = startTaskSimulator(engine, {
      scheduler: options.scheduler,
      behaviour: () => jobBehaviour,
    })
  }

  function ok(summary: string): ServerReply {
    return { ok: true, summary, sequence, projectGeneration }
  }

  return {
    handle(request, expectedGeneration = projectGeneration) {
      if (expectedGeneration !== projectGeneration) {
        return {
          ok: false,
          status: 409,
          body: {
            success: false,
            code: 'project_changed',
            message:
              'The project changed while this request was waiting. The request was not applied; try again in the current project.',
          },
        }
      }
      switch (request.type) {
        case 'command':
          return handleCommand(request)
        case 'project.save': {
          if (!meta.currentProject)
            return {
              ok: false,
              ...serverError('Open or create a project first.', 409),
            }
          if (meta.catalogError)
            return { ok: false, ...serverError(meta.catalogError, 503) }
          const state = engine.getState()
          const savedAt = now().toISOString()
          const previous = catalog.projects.find(
            (entry) => entry.id === state.project.id,
          )
          const next = {
            projects: [
              ...catalog.projects.filter(
                (entry) => entry.id !== state.project.id,
              ),
              {
                id: state.project.id,
                name: state.project.name,
                state,
                savedAt,
                lastOpenedAt: previous?.lastOpenedAt ?? savedAt,
              },
            ],
          }
          const result = writeProjectCatalog(options.storage, next)
          if (!result.ok) {
            return { ok: false, ...serverError(result.message, 503) }
          }
          catalog = next
          meta = {
            ...meta,
            dirty: false,
            savedAt,
            projects: projectSummaries(catalog),
          }
          const summary = `Saved the project in this browser at ${new Date(savedAt).toLocaleTimeString()}.`
          engine.record({
            type: 'project.save',
            title: 'Save project',
            source: request.source,
            summary,
          })
          return { ok: true, summary, sequence, projectGeneration }
        }
        case 'project.replace': {
          const running = activeTaskId()
          if (running) return { ok: false, ...runInProgress(running, 'stage') }
          const fixture = FIXTURES[request.fixture]
          const summary =
            request.fixture === 'new'
              ? 'Started a new empty synthetic project. The copy saved in this browser is unchanged until you save.'
              : `Loaded the "${fixture.label}" fixture: ${fixture.description} The copy saved in this browser is unchanged until you save.`
          const state = buildFixture(request.fixture, now)
          state.project = {
            ...state.project,
            id: `project:${crypto.randomUUID()}`,
          }
          replaceSession(
            state,
            {
              type: 'project.replace',
              title: request.fixture === 'new' ? 'New project' : 'Load fixture',
              input: { fixture: request.fixture },
              source: request.source,
              summary,
            },
            null,
          )
          return { ok: true, summary, sequence, projectGeneration }
        }
        case 'project.list': {
          const refreshed = readProjectCatalog(options.storage)
          if (!refreshed.error) catalog = refreshed.catalog
          meta = {
            ...meta,
            projects: projectSummaries(catalog),
            catalogReady: true,
            catalogError: refreshed.error,
          }
          if (refreshed.error) {
            emit([])
            return { ok: false, ...serverError(refreshed.error, 503) }
          }
          const summary =
            refreshed.error ??
            `Found ${catalog.projects.length} saved project(s) in this browser.`
          engine.record({
            type: request.type,
            title: 'List projects',
            source: request.source,
            summary,
          })
          return ok(summary)
        }
        case 'project.create': {
          const parsed = projectNameSchema.safeParse(request.name)
          if (!parsed.success)
            return {
              ok: false,
              ...invalidRequest([
                {
                  path: 'name',
                  message: 'Enter a project name from 1 to 100 characters.',
                },
              ]),
            }
          const name = parsed.data
          const running = activeTaskId()
          if (running) return { ok: false, ...runInProgress(running, 'stage') }
          const state = createInitialState()
          state.project = {
            ...state.project,
            id: `project:${crypto.randomUUID()}`,
            name,
          }
          const summary = `Created "${name}". Save it to keep it in this browser.`
          replaceSession(
            state,
            {
              type: request.type,
              title: 'Create project',
              source: request.source,
              summary,
            },
            null,
          )
          return ok(summary)
        }
        case 'project.open': {
          const entry = catalog.projects.find(
            (candidate) => candidate.id === request.projectId,
          )
          if (!entry)
            return {
              ok: false,
              ...serverError(
                'This saved project could not be found. Refresh the project list and try again.',
                404,
              ),
            }
          const running = activeTaskId()
          if (running) return { ok: false, ...runInProgress(running, 'stage') }
          const state = restoreProject(entry)
          const next = {
            projects: catalog.projects.map((candidate) =>
              candidate.id === entry.id
                ? { ...candidate, lastOpenedAt: now().toISOString() }
                : candidate,
            ),
          }
          const result = writeProjectCatalog(options.storage, next)
          if (result.ok) catalog = next
          const summary = `Opened "${entry.name}".${result.ok ? '' : ' Recent history could not be updated.'}`
          replaceSession(
            state,
            {
              type: request.type,
              title: 'Open project',
              source: request.source,
              summary,
            },
            entry.savedAt,
          )
          return ok(summary)
        }
        case 'project.close': {
          const running = activeTaskId()
          if (running) return { ok: false, ...runInProgress(running, 'stage') }
          const summary =
            'Closed the project. Saved projects remain in this browser.'
          replaceSession(
            null,
            {
              type: request.type,
              title: 'Close project',
              source: request.source,
              summary,
            },
            null,
          )
          return ok(summary)
        }
      }
    },
    current: () => ({
      sequence,
      projectGeneration,
      state: meta.currentProject ? engine.getState() : null,
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
