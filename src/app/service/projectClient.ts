import { createStore, type StoreApi } from 'zustand/vanilla'
import {
  commandDefinitions,
  type Command,
  type ValidationIssue,
} from '../../domain/commands.ts'
import type { CommandSource, WorkbenchState } from '../../domain/types.ts'
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

/** The UI's workbench refuses server commands, so none can bypass the server. */
export function refuseServerCommand(type: Command['type']): string | null {
  return isServerCommand(type)
    ? `"${commandDefinitions[type].title}" is a server request; send it through the project client.`
    : null
}

export type PendingRequest = {
  id: number
  /** A command type, `project.save`, or `project.replace`. */
  type: string
  title: string
  input: unknown
  source: CommandSource
}

export type ClientSnapshot = {
  pending: PendingRequest[]
  meta: ServerMeta
  conditions: DemoConditions
}

export type ProjectClient = {
  store: StoreApi<ClientSnapshot>
  /** Runs a local command at once, or sends a server command and waits. */
  execute: (command: Command, source?: CommandSource) => Promise<ExecuteResult>
  save: (source?: CommandSource) => Promise<ExecuteResult>
  replaceProject: (
    fixture: FixtureId,
    source?: CommandSource,
  ) => Promise<ExecuteResult>
  setConditions: (conditions: DemoConditions) => void
  dispose: () => void
}

/** Server state with the UI's own selection, drafts, and focus kept. */
export function mergeServerState(
  server: WorkbenchState,
  local: WorkbenchState,
): WorkbenchState {
  const { selection } = local
  const exists = (id: string) =>
    selection.entityType === 'gridElement'
      ? id in server.gridElements
      : id in server.buildings
  const ids = selection.ids.filter(exists)
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
  let nextRequestId = 1
  const waiters: { sequence: number; resolve: () => void }[] = []
  const store = createStore<ClientSnapshot>()(() => ({
    pending: [],
    meta: options.initial.meta,
    conditions: transport.getConditions(),
  }))

  function adopt(update: ServerUpdate) {
    if (update.sequence <= applied) return
    const caughtUp =
      update.operations.length === 0 && update.sequence > applied + 1
    applied = update.sequence
    workbench.adopt(
      mergeServerState(update.state, workbench.getState()),
      update.operations,
    )
    if (caughtUp) {
      workbench.record({
        type: 'service.resync',
        title: 'Catch up with the server',
        source: 'system',
        summary:
          'Back online: the project was refreshed from the server. Changes made while offline are not listed one by one.',
      })
    }
    store.setState({ meta: update.meta })
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
    | { ok: true; summary: string; operationId: string }
    | { ok: false; result: ExecuteResult }
  > {
    const pending: PendingRequest = {
      id: nextRequestId++,
      type,
      title,
      input,
      source,
    }
    store.setState({ pending: [...store.getState().pending, pending] })
    try {
      const reply: TransportReply = await transport.request(request)
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
      return { ok: true, summary: reply.summary, operationId: entry?.id ?? '' }
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
    command: Command,
    source: CommandSource,
  ): Promise<ExecuteResult> {
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
    if (command.type === 'workflow.runStage') {
      // Focus follows a run, as it did when the UI ran stages itself.
      const { stageId } = command.input
      setLocal((state) => ({
        ...state,
        workflow: { ...state.workflow, currentStageId: stageId },
      }))
    }
    if (command.type === 'edits.apply' && drafts) {
      // Sent drafts are applied; drafts changed meanwhile stay.
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

  return {
    store,
    execute(command, source = 'manual') {
      if (isServerCommand(command.type)) {
        return executeOnServer(command, source)
      }
      return Promise.resolve(workbench.execute(command, source))
    },
    async save(source = 'manual') {
      const sent = await send(
        { type: 'project.save', source },
        'project.save',
        'Save project',
        {},
        source,
      )
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
      // A different project: nothing selected, drafted, or focused carries over.
      setLocal((state) => ({
        ...state,
        selection: { entityType: null, ids: [] },
        pendingEdits: {},
        workflow: { ...state.workflow, currentStageId: null },
      }))
      workbench.clearHistory()
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
