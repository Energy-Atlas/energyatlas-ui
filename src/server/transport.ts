import type { Scheduler } from '../domain/simulator.ts'
import {
  invalidRequest,
  runInProgress,
  serverError,
  type ApiFailure,
} from './apiError.ts'
import { DEFAULT_CONDITIONS, type DemoConditions } from './conditions.ts'
import {
  MODEL_COMMANDS,
  type MockServer,
  type ServerReply,
  type ServerRequest,
  type ServerUpdate,
} from './server.ts'

// Between the UI and the mock server, as HTTP and SignalR will be between the
// UI and RC (decision 0023). Requests and pushed updates take the demo
// conditions' delay; faults answer for the server; offline answers nothing.

export type NetworkFailure = { ok: false; network: true; message: string }

export type TransportReply = ServerReply | NetworkFailure

export type Transport = {
  getConditions: () => DemoConditions
  setConditions: (conditions: DemoConditions) => void
  subscribeConditions: (listener: () => void) => () => void
  request: (
    request: ServerRequest,
    projectGeneration: number,
  ) => Promise<TransportReply>
  /** Pushed updates, in order, after the same delay as replies. */
  subscribe: (listener: (update: ServerUpdate) => void) => () => void
  dispose: () => void
}

export const OFFLINE_MESSAGE =
  'Not sent: the server cannot be reached (demo condition: offline).'

const SERVER_ERROR_MESSAGE =
  'The server failed to handle the request (demo condition: requests fail).'

export function createTransport(
  server: MockServer,
  options: {
    scheduler: Scheduler
    conditions?: DemoConditions
    random?: () => number
    now?: () => number
  },
): Transport {
  const { scheduler } = options
  const random = options.random ?? Math.random
  const now = options.now ?? (() => Date.now())
  let conditions = options.conditions ?? DEFAULT_CONDITIONS
  const conditionListeners = new Set<() => void>()
  const updateListeners = new Set<(update: ServerUpdate) => void>()
  const cancels = new Set<() => void>()
  /** Resolvers waiting for "hold" to be turned off. */
  let held: (() => void)[] = []
  /** When the last queued update is due, so updates arrive in order. */
  let lastDue = 0
  let missedWhileOffline = false

  server.setJobBehaviour(conditions.jobs)

  function delay(): number {
    switch (conditions.latency) {
      case 'none':
        return 0
      case 'normal':
        return 250 + random() * 200
      case 'slow':
        return 2500 + random() * 1000
    }
  }

  function wait(ms: number): Promise<void> {
    return new Promise((resolve) => {
      const cancel = scheduler.schedule(() => {
        cancels.delete(cancel)
        resolve()
      }, ms)
      cancels.add(cancel)
    })
  }

  /** Delivers an update after the delay, never before one queued earlier. */
  function push(update: ServerUpdate) {
    const due = Math.max(lastDue, now() + delay())
    lastDue = due
    const cancel = scheduler.schedule(() => {
      cancels.delete(cancel)
      if (conditions.fault === 'offline') {
        missedWhileOffline = true
        return
      }
      for (const listener of updateListeners) listener(update)
    }, due - now())
    cancels.add(cancel)
  }

  const unsubscribe = server.subscribe((update) => {
    if (conditions.fault === 'offline') {
      missedWhileOffline = true
      return
    }
    push(update)
  })

  function setConditions(next: DemoConditions) {
    const wasOffline = conditions.fault === 'offline'
    conditions = next
    server.setJobBehaviour(next.jobs)
    if (!next.hold && held.length > 0) {
      const release = held
      held = []
      for (const resolve of release) resolve()
    }
    if (wasOffline && next.fault !== 'offline' && missedWhileOffline) {
      // Back online: catch up with one snapshot of what was missed.
      missedWhileOffline = false
      push(server.current())
    }
    for (const listener of conditionListeners) listener()
  }

  /** A refusal the demo conditions make on the server's behalf, or null. */
  function injectedFault(request: ServerRequest): ApiFailure | null {
    switch (conditions.fault) {
      case 'nextRequest':
        setConditions({ ...conditions, fault: 'none' })
        return serverError(SERVER_ERROR_MESSAGE)
      case 'everyRequest':
        return serverError(SERVER_ERROR_MESSAGE)
      case 'editLock':
        return request.type === 'command' &&
          MODEL_COMMANDS.has(request.command.type)
          ? runInProgress('demo-run', 'population')
          : null
      case 'rejectInput': {
        if (
          request.type !== 'command' ||
          !MODEL_COMMANDS.has(request.command.type)
        ) {
          return null
        }
        const field = Object.keys(request.command.input)[0] ?? ''
        return invalidRequest([
          {
            path: field,
            message:
              'The server rejected this value (demo condition: input rejected).',
          },
        ])
      }
      default:
        return null
    }
  }

  return {
    getConditions: () => conditions,
    setConditions,
    subscribeConditions(listener) {
      conditionListeners.add(listener)
      return () => {
        conditionListeners.delete(listener)
      }
    },
    async request(request, projectGeneration) {
      if (conditions.hold) {
        await new Promise<void>((resolve) => held.push(resolve))
      }
      await wait(delay())
      if (conditions.fault === 'offline') {
        return { ok: false, network: true, message: OFFLINE_MESSAGE }
      }
      const fault = injectedFault(request)
      if (fault) return { ok: false, ...fault }
      return server.handle(request, projectGeneration)
    },
    subscribe(listener) {
      updateListeners.add(listener)
      return () => {
        updateListeners.delete(listener)
      }
    },
    dispose() {
      unsubscribe()
      for (const cancel of cancels) cancel()
      cancels.clear()
      updateListeners.clear()
      conditionListeners.clear()
    },
  }
}
