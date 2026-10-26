import type { Workbench } from './workbench.ts'

// Advances queued stage tasks through progress to completion using the shared
// command layer with source "system". Time comes from an injectable scheduler
// so tests can step deterministically.

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
 * server error, or stalling without progress until cancelled.
 */
export type JobBehaviour = 'normal' | 'failPartway' | 'stall'

export const PARTWAY_FAILURE =
  'The server reported an error partway through the run (demo condition: jobs fail partway). Run the stage again to continue.'

export type TaskSimulatorOptions = {
  scheduler: Scheduler
  /** Delay between progress steps. */
  stepMs?: number
  /** Number of steps before completion. */
  steps?: number
  /** Read at every step, so changing it affects runs already going. */
  behaviour?: () => JobBehaviour
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
  const active = new Map<string, () => void>()

  function advance(taskId: string, step: number) {
    active.delete(taskId)
    const task = workbench.getState().tasks[taskId]
    if (!task || (task.status !== 'queued' && task.status !== 'running')) {
      return
    }
    if (task.status === 'queued') {
      workbench.execute({ type: 'task.start', input: { taskId } }, 'system')
    }
    const mode = behaviour()
    if (mode === 'stall') {
      // No progress; check again so a change of condition resumes the run.
      active.set(
        taskId,
        scheduler.schedule(() => advance(taskId, step), stepMs),
      )
      return
    }
    if (mode === 'failPartway' && step >= Math.ceil(steps / 2)) {
      workbench.execute(
        { type: 'task.fail', input: { taskId, message: PARTWAY_FAILURE } },
        'system',
      )
      return
    }
    if (step < steps) {
      workbench.execute(
        {
          type: 'task.reportProgress',
          input: { taskId, progress: step / steps },
        },
        'system',
      )
      active.set(
        taskId,
        scheduler.schedule(() => advance(taskId, step + 1), stepMs),
      )
      return
    }
    workbench.execute({ type: 'task.complete', input: { taskId } }, 'system')
  }

  function sync() {
    const { tasks, taskIds } = workbench.getState()
    for (const taskId of taskIds) {
      const task = tasks[taskId]
      if (!task) continue
      const scheduled = active.get(taskId)
      if (task.status === 'queued' && !scheduled) {
        active.set(
          taskId,
          scheduler.schedule(() => advance(taskId, 1), stepMs),
        )
      } else if (task.status === 'cancelled' && scheduled) {
        scheduled()
        active.delete(taskId)
      }
    }
  }

  const unsubscribe = workbench.store.subscribe(sync)
  sync()
  return () => {
    unsubscribe()
    for (const cancel of active.values()) cancel()
    active.clear()
  }
}
