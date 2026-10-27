import { createStore, type StoreApi } from 'zustand/vanilla'
import type { CommandSource } from '../../domain/types.ts'
import type { OperationEntry, Workbench } from '../../domain/workbench.ts'
import {
  OFFLINE_MESSAGE,
  SERVER_ERROR_MESSAGE,
} from '../../server/transport.ts'
import type { AgentSnapshot } from '../agent/types.ts'
import {
  watchJobCompletions,
  type SessionGeneration,
} from '../jobs/jobNotices.ts'
import type { PageId, PanelId } from '../layout/layoutController.ts'
import { viewOperationDefinitions } from '../view/viewOperations.ts'

// One message store (decision 0027): every event the workbench tells people
// about, kept as history. Things that happened go here; state stays where it
// is shown. Asynchronous events and failures also pop up as toasts; applied
// commands reach the status bar and the history without a popup.

export type MessageTone = 'info' | 'success' | 'warning' | 'danger'

/** What a message is about, for filtering the history. */
export type MessageSource = 'project' | 'workspace' | 'job' | 'agent' | 'server'

export const MESSAGE_SOURCES: Record<MessageSource, string> = {
  project: 'Project',
  job: 'Jobs',
  agent: 'Agent',
  server: 'Server',
  workspace: 'Workspace',
}

/** Something a message offers to do, resolved by the UI. */
export type MessageAction =
  | { kind: 'openJob'; label: string; taskId: string }
  | { kind: 'openPanel'; label: string; panel: PanelId }
  | { kind: 'openPage'; label: string; page: PageId }

export type Message = {
  id: string
  at: string
  tone: MessageTone
  source: MessageSource
  /** Who caused it: a person, the agent, or the system. */
  actor: CommandSource
  /** The project it belongs to; null for the server connection. */
  projectId: string | null
  text: string
  /** The operation log entry it reports, if any. */
  operationId: string | null
  actions: MessageAction[]
  /** Raised as a toast when it arrived. */
  toast: boolean
  read: boolean
  /** No longer needs attention, such as an answered approval. */
  resolved: boolean
}

export type MessagesSnapshot = {
  /** Oldest first. */
  messages: Message[]
  /** Ids of the toasts on screen, newest first. */
  toasts: string[]
}

export type MessageInput = Omit<
  Message,
  'id' | 'at' | 'read' | 'resolved' | 'actions' | 'operationId' | 'actor'
> & {
  actions?: MessageAction[]
  operationId?: string | null
  actor?: CommandSource
}

export type MessageCenter = {
  store: StoreApi<MessagesSnapshot>
  post: (input: MessageInput) => Message
  /** Takes a toast off the screen and marks its message read. */
  dismissToast: (id: string, options?: { read?: boolean }) => void
  /** Marks messages read: the given ids, or every message in the scope. */
  markRead: (scope: { ids: string[] } | { projectId: string | null }) => void
  /** Removes a project's messages (and the server's) from the history. */
  clear: (projectId: string | null) => void
  dispose: () => void
}

/** Toasts on screen at once; older ones leave the screen but stay in history. */
export const TOAST_LIMIT = 3
/** History kept per browser session; the oldest drop off. */
export const HISTORY_LIMIT = 500

// Progress ticks are system bookkeeping; reporting each would drown out the
// operations people care about.
export const QUIET_OPERATION_TYPES: ReadonlySet<string> = new Set([
  'task.start',
  'task.reportProgress',
  'view.resetForProject',
])

const SERVER_FAULTS = new Set([OFFLINE_MESSAGE, SERVER_ERROR_MESSAGE])

/** In the history and in this project's scope: its own messages and the server's. */
export function inScope(message: Message, projectId: string | null): boolean {
  return message.projectId === null || message.projectId === projectId
}

const TONE_RANK: Record<MessageTone, number> = {
  info: 0,
  success: 1,
  warning: 2,
  danger: 3,
}

/** The most severe tone among messages, or null when there are none. */
export function worstTone(messages: Message[]): MessageTone | null {
  let worst: MessageTone | null = null
  for (const message of messages) {
    if (!worst || TONE_RANK[message.tone] > TONE_RANK[worst]) {
      worst = message.tone
    }
  }
  return worst
}

// Local commands that arrange the workspace rather than change the project.
const WORKSPACE_COMMANDS: ReadonlySet<string> = new Set([
  'selection.set',
  'selection.clear',
  'workflow.setCurrentStage',
])

function isWorkspaceOperation(type: string): boolean {
  return (
    type.startsWith('layout.') ||
    type.startsWith('view.') ||
    type.startsWith('demo.') ||
    type in viewOperationDefinitions ||
    WORKSPACE_COMMANDS.has(type)
  )
}

/** The message reporting an operation log entry, or null for quiet entries. */
export function messageForOperation(
  entry: OperationEntry,
  projectId: string,
): MessageInput | null {
  if (QUIET_OPERATION_TYPES.has(entry.type)) return null
  if (entry.type === 'service.resync') {
    return {
      tone: 'success',
      source: 'server',
      actor: entry.source,
      projectId: null,
      text: entry.summary ?? entry.title,
      operationId: entry.id,
      toast: true,
    }
  }
  if (entry.status === 'rejected') {
    const general = entry.issues.find((issue) => issue.path === '')
    const text = entry.issues[0]?.message ?? `${entry.title} was not applied.`
    const fault = entry.issues.some((issue) => SERVER_FAULTS.has(issue.message))
    return {
      tone: fault || general ? 'danger' : 'warning',
      source: fault
        ? 'server'
        : isWorkspaceOperation(entry.type)
          ? 'workspace'
          : 'project',
      actor: entry.source,
      projectId: fault ? null : projectId,
      text,
      operationId: entry.id,
      // Field errors on a person's own form show beside the fields instead.
      toast: Boolean(general) || entry.source !== 'manual',
    }
  }
  return {
    tone: 'info',
    source: isWorkspaceOperation(entry.type) ? 'workspace' : 'project',
    actor: entry.source,
    projectId,
    text: entry.summary ?? entry.title,
    operationId: entry.id,
    toast: false,
  }
}

const AGENT_TONES = {
  info: 'info',
  warning: 'warning',
  error: 'danger',
} as const satisfies Record<string, MessageTone>

export function createMessageCenter(options: {
  workbench: Workbench
  session?: SessionGeneration
  agent?: StoreApi<AgentSnapshot>
  now?: () => Date
}): MessageCenter {
  const { workbench, session, agent } = options
  const now = options.now ?? (() => new Date())
  const store = createStore<MessagesSnapshot>()(() => ({
    messages: [],
    toasts: [],
  }))
  let next = 1

  const post = (input: MessageInput): Message => {
    const message: Message = {
      actions: [],
      operationId: null,
      actor: 'system',
      ...input,
      id: `message-${next++}`,
      at: now().toISOString(),
      read: !input.toast,
      resolved: false,
    }
    const { messages, toasts } = store.getState()
    store.setState({
      messages: [...messages, message].slice(-HISTORY_LIMIT),
      toasts: message.toast
        ? [message.id, ...toasts].slice(0, TOAST_LIMIT)
        : toasts,
    })
    return message
  }

  const update = (
    ids: ReadonlySet<string>,
    change: Partial<Pick<Message, 'read' | 'resolved'>>,
  ) => {
    const { messages } = store.getState()
    if (!messages.some((message) => ids.has(message.id))) return
    store.setState({
      messages: messages.map((message) =>
        ids.has(message.id) ? { ...message, ...change } : message,
      ),
    })
  }

  // The operation log: every entry after the last one reported.
  let reported = 0
  const followLog = (log: OperationEntry[]) => {
    const projectId = workbench.getState().project.id
    for (const entry of log) {
      if (entry.sequence <= reported) continue
      reported = entry.sequence
      const input = messageForOperation(entry, projectId)
      if (input) post(input)
    }
  }
  followLog(workbench.store.getState().log)
  const unsubscribeLog = workbench.store.subscribe((snapshot, previous) => {
    if (snapshot.log !== previous.log) followLog(snapshot.log)
  })

  const stopJobs = watchJobCompletions(
    workbench,
    (notice) =>
      post({
        tone: notice.tone,
        source: 'job',
        projectId: notice.projectId,
        text: notice.message,
        actions: [
          { kind: 'openJob', label: 'Open job', taskId: notice.taskId },
        ],
        toast: true,
      }),
    session,
  )

  // A replaced project takes its toasts with it; its history stays, scoped.
  let generation = session?.getGeneration() ?? 0
  const unsubscribeSession = session?.subscribe(() => {
    const current = session.getGeneration()
    if (current === generation) return
    generation = current
    const { messages, toasts } = store.getState()
    const byId = new Map(messages.map((message) => [message.id, message]))
    store.setState({
      toasts: toasts.filter((id) => byId.get(id)?.projectId === null),
    })
  })

  // The agent: approvals it waits for, and the notices it raises.
  const agentMessages = new Map<string, string>()
  const followAgent = (snapshot: AgentSnapshot) => {
    const projectId = workbench.getState().project.id
    for (const item of snapshot.transcript) {
      const posted = agentMessages.get(item.id)
      if (item.kind === 'approval') {
        if (!posted && item.status === 'pending') {
          const message = post({
            tone: 'warning',
            source: 'agent',
            actor: 'agent',
            projectId,
            text: `The agent is waiting for your approval: ${item.title}.`,
            actions: [
              {
                kind: 'openPanel',
                label: 'Open Reasoning',
                panel: 'reasoning',
              },
            ],
            toast: true,
          })
          agentMessages.set(item.id, message.id)
        } else if (posted && item.status !== 'pending') {
          resolve(posted)
          agentMessages.delete(item.id)
        }
      } else if (item.kind === 'notice' && !posted) {
        const message = post({
          tone: AGENT_TONES[item.tone],
          source: 'agent',
          actor: 'agent',
          projectId,
          text: item.text,
          actions: [
            { kind: 'openPanel', label: 'Open Reasoning', panel: 'reasoning' },
          ],
          toast: item.tone === 'error',
        })
        agentMessages.set(item.id, message.id)
      }
    }
    // A cleared transcript (a replaced project) answers nothing more.
    const present = new Set(snapshot.transcript.map((item) => item.id))
    for (const [itemId, messageId] of agentMessages) {
      if (!present.has(itemId)) {
        resolve(messageId)
        agentMessages.delete(itemId)
      }
    }
  }
  const resolve = (id: string) => {
    update(new Set([id]), { read: true, resolved: true })
    const { toasts } = store.getState()
    if (toasts.includes(id)) {
      store.setState({ toasts: toasts.filter((toast) => toast !== id) })
    }
  }
  if (agent) followAgent(agent.getState())
  const unsubscribeAgent = agent?.subscribe((snapshot, previous) => {
    if (snapshot.transcript !== previous.transcript) followAgent(snapshot)
  })

  return {
    store,
    post,
    dismissToast(id, { read = true } = {}) {
      const { toasts } = store.getState()
      if (toasts.includes(id)) {
        store.setState({ toasts: toasts.filter((toast) => toast !== id) })
      }
      if (read) update(new Set([id]), { read: true })
    },
    markRead(scope) {
      const ids =
        'ids' in scope
          ? new Set(scope.ids)
          : new Set(
              store
                .getState()
                .messages.filter(
                  (message) =>
                    !message.read && inScope(message, scope.projectId),
                )
                .map((message) => message.id),
            )
      update(ids, { read: true })
    },
    clear(projectId) {
      const { messages, toasts } = store.getState()
      const kept = messages.filter((message) => !inScope(message, projectId))
      const keptIds = new Set(kept.map((message) => message.id))
      store.setState({
        messages: kept,
        toasts: toasts.filter((id) => keptIds.has(id)),
      })
    },
    dispose() {
      unsubscribeLog()
      stopJobs()
      unsubscribeSession?.()
      unsubscribeAgent?.()
    },
  }
}
