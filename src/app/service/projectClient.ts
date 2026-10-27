import { createStore, type StoreApi } from 'zustand/vanilla'
import {
  commandDefinitions,
  type Command,
  type ValidationIssue,
} from '../../domain/commands.ts'
import {
  selectableCollection,
  type CommandSource,
  type WorkbenchState,
} from '../../domain/types.ts'
import { createInitialState } from '../../domain/initialState.ts'
import type { ExecuteResult, Workbench } from '../../domain/workbench.ts'
import { issuesFromError } from '../../server/apiError.ts'
import {
  describeConditions,
  storeConditions,
  type DemoConditions,
} from '../../server/conditions.ts'
import type { FixtureId } from '../../server/fixtures.ts'
import {
  SERVER_COMMANDS,
  type ServerMeta,
  type ServerRequest,
  type ServerUpdate,
} from '../../server/server.ts'
import type { Transport, TransportReply } from '../../server/transport.ts'

// The UI's side of the mock server (decision 0023). Local commands run on the
// UI's workbench at once; server commands go through the transport, and the
// UI's state follows the server's updates, keeping its own selection, drafts,
// and focused stage. In RC this talks HTTP and SignalR instead.

/** Drafts are the only changes Ctrl+Z undoes; the server's changes are not. */
export const DRAFT_COMMANDS: ReadonlySet<Command['type']> = new Set([
  'edits.propose',
  'edits.discard',
])

export function isServerCommand(type: Command['type']): boolean {
  return SERVER_COMMANDS.has(type)
}

/** Prevents bypassing server commands or changing drafts while Apply is pending. */
export function refuseServerCommand(
  type: Command['type'] | 'history.undo' | 'history.redo',
  pending: PendingRequest[] = [],
  hasProject = true,
  transitioning = false,
): string | null {
  if (transitioning)
    return 'The project session is changing. Wait for it to finish before editing or undoing.'
  if (!hasProject) return 'Open or create a project first.'
  if (
    (type === 'edits.propose' ||
      type === 'edits.discard' ||
      type === 'history.undo' ||
      type === 'history.redo') &&
    pending.some((request) => request.type === 'edits.apply')
  ) {
    return 'Waiting for the server to answer Apply. Drafts can be changed or undone after it answers.'
  }
  if (type === 'history.undo' || type === 'history.redo') return null
  return isServerCommand(type)
    ? `"${commandDefinitions[type].title}" is a server request; send it through the project client.`
    : null
}

/**
 * Gives job submissions a key so a repeated delivery of the same request
 * creates nothing new on the server (jobs rollout plan, shared run contract).
 */
export function withRequestId(command: Command): Command {
  if (
    (command.type === 'workflow.runStage' || command.type === 'job.retry') &&
    !command.input.requestId
  ) {
    return {
      ...command,
      input: { ...command.input, requestId: crypto.randomUUID() },
    } as Command
  }
  return command
}

export type PendingRequest = {
  id: number
  projectGeneration: number
  /** A command type, `project.save`, or `project.replace`. */
  type: string
  title: string
  input: unknown
  source: CommandSource
}

export type ClientSnapshot = {
  projectGeneration: number
  transitioning: boolean
  saveError: string | null
  pending: PendingRequest[]
  meta: ServerMeta
  conditions: DemoConditions
}

export type ProjectClient = {
  store: StoreApi<ClientSnapshot>
  /** Runs a local command at once, or sends a server command and waits. */
  execute: (command: Command, source?: CommandSource) => Promise<ExecuteResult>
  /** Lifecycle-only mutation fence; its callback can cancel jobs and apply drafts. */
  withTransition: (
    operation: (execute: ProjectClient['execute']) => Promise<ExecuteResult>,
  ) => Promise<ExecuteResult>
  save: (source?: CommandSource) => Promise<ExecuteResult>
  replaceProject: (
    fixture: FixtureId,
    source?: CommandSource,
  ) => Promise<ExecuteResult>
  listProjects: (source?: CommandSource) => Promise<ExecuteResult>
  createProject: (
    name: string,
    source?: CommandSource,
  ) => Promise<ExecuteResult>
  openProject: (
    projectId: string,
    source?: CommandSource,
  ) => Promise<ExecuteResult>
  closeProject: (source?: CommandSource) => Promise<ExecuteResult>
  setConditions: (conditions: DemoConditions) => void
  dispose: () => void
}

/** Server state with the UI's own selection, drafts, and focus kept. */
export function mergeServerState(
  server: WorkbenchState,
  local: WorkbenchState,
): WorkbenchState {
  const { selection } = local
  const collection = selection.entityType
    ? selectableCollection(server, selection.entityType)
    : {}
  const ids = selection.ids.filter((id) => id in collection)
  const pendingEdits = Object.fromEntries(
    Object.entries(local.pendingEdits).filter(
      ([, edit]) => edit.entityId in server.buildings,
    ),
  )
  const focus = local.workflow.currentStageId
  return {
    ...server,
    selection: {
      entityType: ids.length > 0 ? selection.entityType : null,
      ids,
    },
    pendingEdits,
    workflow: {
      ...server.workflow,
      currentStageId:
        focus && focus in server.workflow.stages
          ? focus
          : server.workflow.currentStageId,
    },
  }
}

export function createProjectClient(options: {
  workbench: Workbench
  transport: Transport
  session: Storage | null
  initial: ServerUpdate
}): ProjectClient {
  const { workbench, transport, session } = options
  let applied = options.initial.sequence
  let projectGeneration = options.initial.projectGeneration
  let nextRequestId = 1
  const waiters: { sequence: number; resolve: () => void }[] = []
  const store = createStore<ClientSnapshot>()(() => ({
    projectGeneration,
    transitioning: false,
    saveError: null,
    pending: [],
    meta: options.initial.meta,
    conditions: transport.getConditions(),
  }))

  function adopt(update: ServerUpdate) {
    if (update.sequence <= applied) return
    const caughtUp =
      update.operations.length === 0 && update.sequence > applied + 1
    applied = update.sequence
    const replaced = update.projectGeneration !== projectGeneration
    projectGeneration = update.projectGeneration
    workbench.adopt(
      update.state === null
        ? createInitialState()
        : replaced
          ? update.state
          : mergeServerState(update.state, workbench.getState()),
      update.operations,
    )
    if (replaced) workbench.clearHistory()
    if (caughtUp) {
      workbench.record({
        type: 'service.resync',
        title: 'Catch up with the server',
        source: 'system',
        summary:
          'Back online: the project was refreshed from the server. Changes made while offline are not listed one by one.',
      })
    }
    store.setState({
      meta: update.meta,
      projectGeneration,
      ...(replaced ? { saveError: null } : {}),
    })
    for (const waiter of [...waiters]) {
      if (waiter.sequence <= applied) {
        waiters.splice(waiters.indexOf(waiter), 1)
        waiter.resolve()
      }
    }
  }

  const unsubscribe = transport.subscribe(adopt)
  const unsubscribeConditions = transport.subscribeConditions(() => {
    // The transport resets a one-off fault itself; keep the session in step.
    const conditions = transport.getConditions()
    storeConditions(session, conditions)
    store.setState({ conditions })
  })

  function caughtUpTo(sequence: number): Promise<void> {
    if (sequence <= applied) return Promise.resolve()
    return new Promise((resolve) => waiters.push({ sequence, resolve }))
  }

  /** Sends one request, marking it pending until the reply and its state arrive. */
  async function send(
    request: ServerRequest,
    type: string,
    title: string,
    input: unknown,
    source: CommandSource,
  ): Promise<
    | {
        ok: true
        summary: string
        operationId: string
        currentProject: boolean
      }
    | { ok: false; result: ExecuteResult }
  > {
    const pending: PendingRequest = {
      id: nextRequestId++,
      projectGeneration,
      type,
      title,
      input,
      source,
    }
    store.setState({ pending: [...store.getState().pending, pending] })
    try {
      const reply: TransportReply = await transport.request(
        request,
        projectGeneration,
      )
      if (!reply.ok) {
        const issues: ValidationIssue[] =
          'network' in reply
            ? [{ path: '', message: reply.message }]
            : issuesFromError(reply.body)
        const operationId = workbench.record({
          type,
          title,
          input,
          source,
          status: 'rejected',
          summary: '',
          issues,
        })
        return {
          ok: false,
          result: { operationId, outcome: { status: 'rejected', issues } },
        }
      }
      await caughtUpTo(reply.sequence)
      const entry = workbench.store
        .getState()
        .log.findLast(
          (candidate) =>
            candidate.type === type &&
            candidate.source === source &&
            candidate.status === 'applied',
        )
      return {
        ok: true,
        summary: reply.summary,
        operationId: entry?.id ?? '',
        currentProject: reply.projectGeneration === projectGeneration,
      }
    } finally {
      store.setState({
        pending: store
          .getState()
          .pending.filter((request) => request.id !== pending.id),
      })
    }
  }

  /** Replaces local state without logging, for follow-ups of a server reply. */
  function setLocal(recipe: (state: WorkbenchState) => WorkbenchState) {
    workbench.adopt(recipe(workbench.getState()), [])
  }

  async function executeOnServer(
    submitted: Command,
    source: CommandSource,
  ): Promise<ExecuteResult> {
    const command = withRequestId(submitted)
    const drafts =
      command.type === 'edits.apply'
        ? workbench.getState().pendingEdits
        : undefined
    const sent = await send(
      { type: 'command', command, source, drafts },
      command.type,
      commandDefinitions[command.type].title,
      command.input,
      source,
    )
    if (!sent.ok) return sent.result
    if (sent.currentProject && command.type === 'workflow.runStage') {
      // Focus follows a run, as it did when the UI ran stages itself.
      const { stageId } = command.input
      setLocal((state) => ({
        ...state,
        workflow: { ...state.workflow, currentStageId: stageId },
      }))
    }
    if (sent.currentProject && command.type === 'edits.apply' && drafts) {
      // Draft changes are refused while Apply is pending.
      setLocal((state) => ({
        ...state,
        pendingEdits: Object.fromEntries(
          Object.entries(state.pendingEdits).filter(
            ([key, edit]) => drafts[key]?.to !== edit.to,
          ),
        ),
      }))
      workbench.clearHistory()
    }
    return {
      operationId: sent.operationId,
      outcome: { status: 'applied', summary: sent.summary },
    }
  }

  async function projectRequest(
    request: ServerRequest,
    title: string,
    input: unknown,
  ): Promise<ExecuteResult> {
    const sent = await send(request, request.type, title, input, request.source)
    return sent.ok
      ? {
          operationId: sent.operationId,
          outcome: { status: 'applied', summary: sent.summary },
        }
      : sent.result
  }

  function executeDirect(
    command: Command,
    source: CommandSource = 'manual',
  ): Promise<ExecuteResult> {
    return isServerCommand(command.type)
      ? executeOnServer(command, source)
      : Promise.resolve(workbench.execute(command, source))
  }

  return {
    store,
    execute(command, source = 'manual') {
      if (store.getState().transitioning) {
        const issues = [
          {
            path: '',
            message:
              'The project session is changing. Wait for it to finish before editing.',
          },
        ]
        const operationId = workbench.record({
          type: command.type,
          title: commandDefinitions[command.type].title,
          source,
          status: 'rejected',
          summary: '',
          issues,
        })
        return Promise.resolve({
          operationId,
          outcome: { status: 'rejected', issues },
        })
      }
      return executeDirect(command, source)
    },
    async withTransition(operation) {
      store.setState({ transitioning: true })
      try {
        return await operation(executeDirect)
      } finally {
        store.setState({ transitioning: false })
      }
    },
    async listProjects(source = 'manual') {
      const result = await projectRequest(
        { type: 'project.list', source },
        'List projects',
        {},
      )
      if (result.outcome.status === 'rejected')
        store.setState({
          meta: {
            ...store.getState().meta,
            catalogReady: true,
            catalogError: result.outcome.issues
              .map((issue) => issue.message)
              .join(' '),
          },
        })
      return result
    },
    createProject(name, source = 'manual') {
      return projectRequest(
        { type: 'project.create', name, source },
        'Create project',
        { name },
      )
    },
    openProject(projectId, source = 'manual') {
      return projectRequest(
        { type: 'project.open', projectId, source },
        'Open project',
        { projectId },
      )
    },
    closeProject(source = 'manual') {
      return projectRequest(
        { type: 'project.close', source },
        'Close project',
        {},
      )
    },
    async save(source = 'manual') {
      const savingGeneration = projectGeneration
      const sent = await send(
        { type: 'project.save', source },
        'project.save',
        'Save project',
        {},
        source,
      )
      if (savingGeneration === projectGeneration)
        store.setState({
          saveError: sent.ok
            ? null
            : sent.result.outcome.status === 'rejected'
              ? sent.result.outcome.issues
                  .map((issue) => issue.message)
                  .join(' ')
              : null,
        })
      if (!sent.ok) return sent.result
      return {
        operationId: sent.operationId,
        outcome: { status: 'applied', summary: sent.summary },
      }
    },
    async replaceProject(fixture, source = 'manual') {
      const sent = await send(
        { type: 'project.replace', fixture, source },
        'project.replace',
        fixture === 'new' ? 'New project' : 'Load fixture',
        { fixture },
        source,
      )
      if (!sent.ok) return sent.result
      // Adoption clears project-local state when the replacement arrives.
      return {
        operationId: sent.operationId,
        outcome: { status: 'applied', summary: sent.summary },
      }
    },
    setConditions(conditions) {
      transport.setConditions(conditions)
      const labels = describeConditions(conditions)
      workbench.record({
        type: 'demo.setConditions',
        title: 'Set demo conditions',
        input: conditions,
        summary:
          labels.length > 0
            ? `Demo conditions: ${labels.join(', ')}.`
            : 'Demo conditions are back to normal.',
      })
    },
    dispose() {
      unsubscribe()
      unsubscribeConditions()
    },
  }
}
