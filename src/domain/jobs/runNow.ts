import type { CommandSource } from '../types.ts'
import type { ExecuteResult, Workbench } from '../workbench.ts'

/**
 * Runs one stage to its end at once through the shared commands, as the job
 * runner would over time: queue, start, process every item, complete. For
 * fixtures and tests; returns the completion, or the rejected submission.
 */
export function runStageNow(
  workbench: Workbench,
  stageId: string,
  source: CommandSource = 'manual',
): ExecuteResult {
  const queued = workbench.execute(
    { type: 'workflow.runStage', input: { stageId } },
    source,
  )
  if (queued.outcome.status !== 'applied') return queued
  return finishJobNow(workbench, workbench.getState().taskIds.at(-1) ?? '')
}

/** Starts a queued job and runs it to its end at once. */
export function finishJobNow(
  workbench: Workbench,
  taskId: string,
  options: { failures?: Record<string, string>; failPublication?: string } = {},
): ExecuteResult {
  workbench.execute({ type: 'task.start', input: { taskId } }, 'system')
  const items = workbench.getState().tasks[taskId]?.items
  if (items && items.processed < items.ids.length) {
    workbench.execute(
      {
        type: 'task.processItems',
        input: {
          taskId,
          count: items.ids.length - items.processed,
          failures: options.failures ?? {},
        },
      },
      'system',
    )
  }
  return workbench.execute(
    {
      type: 'task.complete',
      input: {
        taskId,
        ...(options.failPublication
          ? { failPublication: options.failPublication }
          : {}),
      },
    },
    'system',
  )
}
