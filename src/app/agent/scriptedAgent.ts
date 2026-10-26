import { createStore } from 'zustand/vanilla'
import { planStages, type Requirement } from '../../domain/stagePlan.ts'
import type { Scheduler } from '../../domain/simulator.ts'
import { deriveStageStates, hasActiveTask } from '../../domain/workflow.ts'
import {
  matchSession,
  SESSIONS,
  type ScriptContext,
  type ScriptedSession,
  type Step,
  type StepSource,
  type TitledCall,
} from './sessions.ts'
import { permissionModeOption } from './modes.ts'
import {
  command,
  executeToolCall,
  requiresApproval,
  type ToolCall,
  type ToolDeps,
  type ToolResult,
} from './tools.ts'
import type {
  AgentAdapter,
  AgentSnapshot,
  PermissionMode,
  SendMode,
  TranscriptItem,
} from './types.ts'

/** Pause between transcript steps, so a replay reads as a session. */
export const STEP_DELAY_MS = 350
const STAGE_POLL_MS = 200

export type ScriptedAgentOptions = ToolDeps & {
  scheduler: Scheduler
  stepDelayMs?: number
}

/**
 * Replays scripted sessions (decision 0006). Tool calls that run stages or
 * change the project model wait for approval, and missing project state is
 * explained and offered as one approval (decision 0011).
 */
export function createScriptedAgent(
  options: ScriptedAgentOptions,
): AgentAdapter {
  const { workbench, scheduler, stepDelayMs = STEP_DELAY_MS } = options
  const deps: ToolDeps = {
    workbench: options.workbench,
    client: options.client,
    lifecycle: options.lifecycle,
    view: options.view,
    layout: options.layout,
  }
  const store = createStore<AgentSnapshot>()(() => ({
    status: 'idle',
    transcript: [],
    activeSessionId: null,
    presets: SESSIONS.map(({ id, label, prompt, description }) => ({
      id,
      label,
      prompt,
      description,
    })),
    permissionMode: 'ask',
    queued: [],
    ranSessionIds: [],
  }))

  let itemCount = 0
  let sessionGeneration = 0
  let queue: StepSource[] = []
  let approvedCalls: TitledCall[] = []
  let pending: { itemId: string; title: string; calls: TitledCall[] } | null =
    null
  let cancelTimer: (() => void) | null = null
  let context = createContext()

  function createContext(): ScriptContext {
    return {
      state: () => workbench.getState(),
      stageStates: () => {
        const state = workbench.getState()
        return deriveStageStates(state.workflow, state.tasks)
      },
      memory: {},
    }
  }

  function nextId(): string {
    itemCount += 1
    return `agent-item-${itemCount}`
  }

  function push(item: TranscriptItem) {
    store.setState({ transcript: [...store.getState().transcript, item] })
  }

  function setApprovalStatus(itemId: string, status: 'approved' | 'declined') {
    store.setState({
      transcript: store
        .getState()
        .transcript.map((item) =>
          item.kind === 'approval' && item.id === itemId
            ? { ...item, status }
            : item,
        ),
    })
  }

  function isRunning(): boolean {
    return store.getState().status === 'running'
  }

  function schedule(callback: () => void, delay = stepDelayMs) {
    cancelTimer?.()
    cancelTimer = scheduler.schedule(() => {
      cancelTimer = null
      callback()
    }, delay)
  }

  function finish() {
    sessionGeneration += 1
    cancelTimer?.()
    cancelTimer = null
    queue = []
    approvedCalls = []
    pending = null
    store.setState({ status: 'idle', activeSessionId: null })
    deliverQueued()
  }

  /** Hands the oldest queued message to the agent now that it is idle. */
  function deliverQueued() {
    const [next, ...rest] = store.getState().queued
    if (next === undefined) return
    store.setState({ queued: rest })
    schedule(() => deliver(next))
  }

  /** Answers a message: starts the session it matches, or explains that none does. */
  function deliver(prompt: string) {
    const session = matchSession(prompt)
    if (session) {
      start(session, prompt)
      return
    }
    push({ id: nextId(), kind: 'user', text: prompt })
    push({
      id: nextId(),
      kind: 'agent',
      markdown:
        'I am a **scripted agent** in this prototype. I can only run the prepared sessions offered below, so I did not act on this message. Choose a session, or use the workbench controls directly.',
    })
    deliverQueued()
  }

  function endWith(tone: 'info' | 'warning' | 'error', text: string) {
    push({ id: nextId(), kind: 'notice', tone, text })
    finish()
  }

  function start(session: ScriptedSession, prompt: string) {
    if (store.getState().status !== 'idle') return
    sessionGeneration += 1
    push({ id: nextId(), kind: 'user', text: prompt })
    workbench.record({
      type: 'agent.startSession',
      title: 'Start agent session',
      input: { sessionId: session.id, prompt },
      summary: `Started the scripted agent session "${session.label}".`,
    })
    context = createContext()
    queue = [...session.steps]
    store.setState({
      status: 'running',
      activeSessionId: session.id,
      ranSessionIds: [...store.getState().ranSessionIds, session.id],
    })
    schedule(advance)
  }

  function advance() {
    if (!isRunning()) return
    const source = queue.shift()
    if (source === undefined) {
      finish()
      return
    }
    if (typeof source === 'function') {
      const produced = source(context)
      const steps =
        produced === null ? [] : Array.isArray(produced) ? produced : [produced]
      queue = [...steps, ...queue]
      advance()
      return
    }
    handle(source)
  }

  function handle(step: Step) {
    switch (step.kind) {
      case 'say':
        push({ id: nextId(), kind: 'agent', markdown: step.markdown })
        schedule(advance)
        return
      case 'reason':
        push({ id: nextId(), kind: 'reasoning', text: step.text })
        schedule(advance)
        return
      case 'reference':
        push({
          id: nextId(),
          kind: 'reference',
          label: step.label,
          target: step.target,
        })
        schedule(advance)
        return
      case 'tool':
        if (requiresApproval(step.call)) {
          propose(step.title, '', [{ title: step.title, call: step.call }])
          return
        }
        runCall({ title: step.title, call: step.call }, () => schedule(advance))
        return
      case 'propose':
        propose(step.title, step.description, step.calls)
        return
      case 'ensure':
        ensure(step.targets, step.purpose, step.requirement)
        return
    }
  }

  function runCall(titled: TitledCall, onDone: () => void) {
    const generation = sessionGeneration
    const call: ToolCall =
      typeof titled.call === 'function' ? titled.call(context) : titled.call
    void executeToolCall(deps, call).then((result) => {
      // The session may have been stopped while the server answered.
      if (generation !== sessionGeneration || !isRunning()) return
      finishCall(titled, call, result, onDone)
    })
  }

  function finishCall(
    titled: TitledCall,
    call: ToolCall,
    result: ToolResult,
    onDone: () => void,
  ) {
    push({ id: nextId(), kind: 'tool', title: titled.title, call, result })
    if (result.status === 'rejected') {
      endWith(
        'error',
        `I stopped because "${titled.title}" was rejected: ${result.issues.map((issue) => issue.message).join(' ')}`,
      )
      return
    }
    if (call.kind === 'command' && call.command.type === 'workflow.runStage') {
      waitForStage(call.command.input.stageId, onDone)
      return
    }
    onDone()
  }

  function waitForStage(stageId: string, onDone: () => void) {
    const check = () => {
      if (!isRunning()) return
      const state = workbench.getState()
      if (hasActiveTask(state.tasks, stageId)) {
        schedule(check, STAGE_POLL_MS)
        return
      }
      const stage = state.workflow.stages[stageId]
      if (stage?.lastRun?.outcome === 'failed') {
        endWith(
          'error',
          `"${stage.name}" failed: ${stage.lastRun.message ?? 'no message was reported.'} I ended the session. Rerun the stage from the Workflow panel, then ask again.`,
        )
        return
      }
      onDone()
    }
    schedule(check, STAGE_POLL_MS)
  }

  /**
   * Workflow calls run or restore stages with simulated computation. Every
   * other call that needs approval changes the project model, which "Automatic"
   * still leaves to the user. A call built at run time is unknown until then,
   * so it counts as a model change.
   */
  function isWorkflowCall(titled: TitledCall): boolean {
    if (typeof titled.call === 'function') return false
    return (
      titled.call.kind === 'command' &&
      titled.call.command.type.startsWith('workflow.')
    )
  }

  /** The permission mode that answers this proposal, or null to ask the user. */
  function autoDecision(calls: TitledCall[]): PermissionMode | null {
    const mode = store.getState().permissionMode
    if (mode === 'bypass' || mode === 'plan') return mode
    if (mode === 'automatic' && calls.every(isWorkflowCall)) return mode
    return null
  }

  function propose(title: string, description: string, calls: TitledCall[]) {
    const decided = autoDecision(calls)
    if (decided === 'plan') {
      push({
        id: nextId(),
        kind: 'agent',
        markdown: `**Plan only.** To continue I would ${title[0]?.toLowerCase()}${title.slice(1)}:\n\n${calls
          .map((call) => `- ${call.title}`)
          .join('\n')}${description ? `\n\n${description}` : ''}`,
      })
      endWith(
        'info',
        'Plan mode: nothing was changed. Choose another permission mode and ask again to carry this out.',
      )
      return
    }
    const itemId = nextId()
    push({
      id: itemId,
      kind: 'approval',
      title,
      description,
      callTitles: calls.map((call) => call.title),
      status: decided ? 'approved' : 'pending',
      decidedBy: decided,
    })
    if (decided) {
      workbench.record({
        type: 'agent.proposal',
        title: `Agent proposal: ${title}`,
        input: {
          calls: calls.map((call) => call.title),
          permissionMode: decided,
        },
        summary: `Approved "${title}" without asking, because the agent is in ${permissionModeOption(decided).label} mode.`,
      })
      approvedCalls = [...calls]
      pending = null
      schedule(runApproved)
      return
    }
    pending = { itemId, title, calls }
    store.setState({ status: 'awaitingApproval' })
  }

  /** Why a send mode cannot be used right now, or null. */
  function sendBlocker(mode: SendMode, text: string): string | null {
    if (!text.trim()) return 'Type a message first.'
    const status = store.getState().status
    if (mode === 'send' && status !== 'idle') {
      return status === 'awaitingApproval'
        ? 'The agent is waiting for your approval. Answer it, or queue this message.'
        : 'A session is running. Queue this message, stir it in, or stop the session.'
    }
    if (mode === 'stir' && status === 'idle') {
      return 'Stirring adds guidance to a running session. Use Send message instead.'
    }
    return null
  }

  function ensure(
    targets: string[],
    purpose: string,
    requirement: Requirement,
  ) {
    const state = workbench.getState()
    const plan = planStages(state.workflow, state.tasks, targets, requirement)
    if (plan.blocker) {
      endWith(
        'warning',
        `${purpose} is not possible right now: ${plan.blocker}`,
      )
      return
    }
    if (plan.steps.length === 0) {
      schedule(advance)
      return
    }
    const stageName = (id: string) => state.workflow.stages[id]?.name ?? id
    const runs = plan.steps.filter((step) => step.action === 'run').length
    const current = requirement === 'current'
    propose(
      `Run ${runs} ${current ? 'outdated or missing' : 'missing'} stage${runs === 1 ? '' : 's'}`,
      `${purpose} needs ${current ? 'current results from' : 'data from'} these stages. I can run them in order with simulated computation, or you can run them yourself from the Workflow panel.`,
      plan.steps.map((step) =>
        step.action === 'restore'
          ? {
              title: `Restore "${stageName(step.stageId)}"`,
              call: command({
                type: 'workflow.setStageSkipped',
                input: { stageId: step.stageId, skipped: false },
              }),
            }
          : {
              title: `Run "${stageName(step.stageId)}"`,
              call: command({
                type: 'workflow.runStage',
                input: { stageId: step.stageId },
              }),
            },
      ),
    )
  }

  function runApproved() {
    if (!isRunning()) return
    const next = approvedCalls.shift()
    if (!next) {
      schedule(advance)
      return
    }
    runCall(next, () => schedule(runApproved))
  }

  return {
    label: 'Scripted agent',
    store,
    resetForProject() {
      sessionGeneration += 1
      cancelTimer?.()
      cancelTimer = null
      queue = []
      approvedCalls = []
      pending = null
      context = createContext()
      store.setState({
        status: 'idle',
        activeSessionId: null,
        transcript: [],
        queued: [],
        ranSessionIds: [],
      })
    },
    send(text, mode = 'send') {
      const prompt = text.trim()
      if (sendBlocker(mode, prompt)) return
      if (mode === 'send') {
        deliver(prompt)
        return
      }
      store.setState({ queued: [...store.getState().queued, prompt] })
      if (mode === 'stir') {
        // A scripted session cannot change course, so say so where it happens
        // rather than implying the message steered it (agent.steering).
        push({ id: nextId(), kind: 'user', text: prompt })
        push({
          id: nextId(),
          kind: 'notice',
          tone: 'info',
          text: 'Noted while the session runs. A scripted session cannot change course, so I will answer this once it ends.',
        })
      }
      workbench.record({
        type: 'agent.queueMessage',
        title: mode === 'stir' ? 'Stir a message in' : 'Queue a message',
        input: { text: prompt, mode },
        summary:
          mode === 'stir'
            ? 'Added the message to the running session; the agent answers it when the session ends.'
            : 'Queued the message; the agent answers it when it is idle.',
      })
      if (store.getState().status === 'idle') deliverQueued()
    },
    sendBlocker,
    startPreset(presetId) {
      const session = SESSIONS.find((candidate) => candidate.id === presetId)
      if (session) start(session, session.prompt)
    },
    setPermissionMode(mode) {
      if (store.getState().permissionMode === mode) return
      store.setState({ permissionMode: mode })
      const option = permissionModeOption(mode)
      workbench.record({
        type: 'agent.setPermissionMode',
        title: 'Set agent permission mode',
        input: { mode },
        summary: `Agent permission mode: ${option.label}. ${option.description}`,
      })
    },
    dropQueued(index) {
      const queued = store.getState().queued
      if (index < 0 || index >= queued.length) return
      store.setState({
        queued: queued.filter((_, position) => position !== index),
      })
      workbench.record({
        type: 'agent.dropQueuedMessage',
        title: 'Remove a queued message',
        input: { text: queued[index] },
        summary: 'Removed a queued message before the agent answered it.',
      })
    },
    approve(itemId) {
      if (store.getState().status !== 'awaitingApproval') return
      if (!pending || pending.itemId !== itemId) return
      setApprovalStatus(itemId, 'approved')
      approvedCalls = [...pending.calls]
      pending = null
      store.setState({ status: 'running' })
      schedule(runApproved)
    },
    decline(itemId) {
      if (store.getState().status !== 'awaitingApproval') return
      if (!pending || pending.itemId !== itemId) return
      setApprovalStatus(itemId, 'declined')
      workbench.record({
        type: 'agent.proposal',
        title: `Agent proposal: ${pending.title}`,
        input: { calls: pending.calls.map((call) => call.title) },
        status: 'rejected',
        summary: '',
        issues: [
          {
            path: '',
            message: `Rejected "${pending.title}"; nothing was changed.`,
          },
        ],
      })
      push({
        id: nextId(),
        kind: 'agent',
        markdown:
          'Understood. I did not make that change, and this session has ended.',
      })
      finish()
    },
    stop() {
      if (store.getState().status === 'idle') return
      if (pending) setApprovalStatus(pending.itemId, 'declined')
      // Stopping means stop: queued messages would otherwise start a session
      // straight after the one the user just ended.
      const dropped = store.getState().queued.length
      store.setState({ queued: [] })
      endWith(
        'info',
        `Session stopped. Changes that were already applied stay in the project.${dropped > 0 ? ` ${dropped} queued message${dropped === 1 ? '' : 's'} discarded.` : ''}`,
      )
    },
  }
}
