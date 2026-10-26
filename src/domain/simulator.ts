import { isActiveStatus } from './jobs/runGroups.ts'
import type { Task, WorkbenchState } from './types.ts'
import type { Workbench } from './workbench.ts'

// The job runner. One job runs at a time per project; the oldest queued job
// starts when none is running (jobs rollout plan, D2). Whole-stage jobs
// advance on timer progress; item jobs compute a batch of items per step and
// hold their outputs on the run group until the group publishes. Every change
// goes through the shared commands with source "system". Time comes from an
// injectable scheduler so tests can step deterministically.

export type Scheduler = {
  schedule: (callback: () => void, delayMs: number) => () => void
}

export const browserScheduler: Scheduler = {
  schedule(callback, delayMs) {
    const handle = window.setTimeout(callback, delayMs)
    return () => window.clearTimeout(handle)
  },
}

/**
 * How runs behave, as a demo condition: normally, failing partway with a
 * server error, stalling until cancelled, failing some items transiently on
 * the first attempt, or failing publication.
 */
export type JobBehaviour =
  'normal' | 'failPartway' | 'stall' | 'itemFailures' | 'publishFails'

export const PARTWAY_FAILURE =
  'The server reported an error partway through the run (demo condition: jobs fail partway). Retry to continue; items already computed stay held.'

export const ITEM_FAILURE =
  'Transient worker fault while deriving this building (demo condition: some items fail). Retry the failed items.'

export const PUBLICATION_FAILURE =
  'the result store refused the write (demo condition: publication fails)'

/** Items the "some items fail" condition fails: a fixed, spread subset of first attempts. */
export function failsTransiently(task: Task, index: number): boolean {
  return task.attempt === 1 && index % 37 === 5
}

export type TaskSimulatorOptions = {
  scheduler: Scheduler
  /** Delay between progress steps. */
  stepMs?: number
  /** Number of steps before completion. */
  steps?: number
  /** Read at every step, so changing it affects runs already going. */
  behaviour?: () => JobBehaviour
}

/** The job that should run now: the running one, else the oldest queued one. */
function nextJob(state: WorkbenchState): Task | null {
  let queued: Task | null = null
  for (const id of state.taskIds) {
    const task = state.tasks[id]
    if (!task) continue
    if (task.status === 'running') return task
    if (task.status === 'queued' && !queued) queued = task
  }
  return queued
}

export function startTaskSimulator(
  workbench: Workbench,
  {
    scheduler,
    stepMs = 400,
    steps = 4,
    behaviour = () => 'normal',
  }: TaskSimulatorOptions,
): () => void {
  let current: { taskId: string; cancel: () => void } | null = null
  let stopped = false
  /** True while a step runs, so the store subscription does not schedule twice. */
  let advancing = false

  function schedule(taskId: string, index: number) {
    current = {
      taskId,
      cancel: scheduler.schedule(() => advance(taskId, index), stepMs),
    }
  }

  function processBatch(task: Task, mode: JobBehaviour) {
    const items = task.items
    if (!items || items.processed >= items.ids.length) return
    const size = Math.max(1, Math.ceil(items.ids.length / steps))
    const start = items.processed
    const failures: Record<string, string> = {}
    if (mode === 'itemFailures') {
      items.ids.slice(start, start + size).forEach((id, offset) => {
        if (failsTransiently(task, start + offset)) failures[id] = ITEM_FAILURE
      })
    }
    workbench.execute(
      {
        type: 'task.processItems',
        input: { taskId: task.id, count: size, failures },
      },
      'system',
    )
  }

  /** One step of the current job; schedules its next step or leaves the queue to `sync`. */
  function step(taskId: string, index: number) {
    const task = workbench.getState().tasks[taskId]
    if (!task || !isActiveStatus(task.status)) return
    if (task.status === 'queued') {
      workbench.execute({ type: 'task.start', input: { taskId } }, 'system')
      if (workbench.getState().tasks[taskId]?.status !== 'running') return
    }
    const mode = behaviour()
    if (mode === 'stall') {
      // No progress; check again so a change of condition resumes the run.
      schedule(taskId, index)
      return
    }
    if (mode === 'failPartway' && index >= Math.ceil(steps / 2)) {
      workbench.execute(
        { type: 'task.fail', input: { taskId, message: PARTWAY_FAILURE } },
        'system',
      )
      return
    }
    const running = workbench.getState().tasks[taskId]
    if (!running) return
    if (running.items) {
      processBatch(running, mode)
      const after = workbench.getState().tasks[taskId]?.items
      if (after && after.processed < after.ids.length) {
        schedule(taskId, index + 1)
        return
      }
    } else if (index < steps) {
      workbench.execute(
        {
          type: 'task.reportProgress',
          input: { taskId, progress: index / steps },
        },
        'system',
      )
      schedule(taskId, index + 1)
      return
    }
    workbench.execute(
      {
        type: 'task.complete',
        input: {
          taskId,
          ...(mode === 'publishFails' && running.items
            ? { failPublication: PUBLICATION_FAILURE }
            : {}),
        },
      },
      'system',
    )
  }

  function advance(taskId: string, index: number) {
    current = null
    advancing = true
    try {
      step(taskId, index)
    } finally {
      advancing = false
    }
    if (!current) sync()
  }

  function sync() {
    if (stopped || advancing) return
    const state = workbench.getState()
    if (current) {
      const task = state.tasks[current.taskId]
      if (task && isActiveStatus(task.status)) return
      current.cancel()
      current = null
    }
    const next = nextJob(state)
    if (next) schedule(next.id, next.status === 'running' ? 2 : 1)
  }

  const unsubscribe = workbench.store.subscribe(sync)
  sync()
  return () => {
    stopped = true
    unsubscribe()
    current?.cancel()
    current = null
  }
}
