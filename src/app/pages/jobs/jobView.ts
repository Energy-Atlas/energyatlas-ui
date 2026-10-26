import {
  groupOf,
  isActiveStatus,
  itemCounts,
  retryBlocker,
  retryScope,
} from '../../../domain/jobs/runGroups.ts'
import type {
  RunGroup,
  Task,
  TaskStatus,
  WorkbenchState,
} from '../../../domain/types.ts'
import { stageSubmitBlocker } from '../../../domain/commands.ts'
import type { PendingRequest } from '../../service/projectClient.ts'
import { waitingReason } from '../../service/usePendingReason.ts'
import type { JobFilter } from '../../view/viewOperations.ts'

// Pure view model for the Jobs page: labels, filters, and why each job
// action is unavailable. The commands decide; these mirror their checks so
// controls explain themselves before anything is sent.

/** RC's job states (decision 0023), plus the demo's queued-but-not-run outcome. */
export const JOB_STATUS_LABELS: Record<TaskStatus, string> = {
  queued: 'Created',
  running: 'Running',
  succeeded: 'Completed',
  failed: 'Failed',
  cancelled: 'Cancelled',
  invalidated: 'Not run',
}

export function matchesFilter(task: Task, filter: JobFilter): boolean {
  switch (filter) {
    case 'all':
      return true
    case 'active':
      return isActiveStatus(task.status)
    case 'attention':
      return (
        task.status === 'failed' ||
        task.status === 'cancelled' ||
        task.status === 'invalidated'
      )
    case 'finished':
      return !isActiveStatus(task.status)
  }
}

/** Jobs newest first, filtered. */
export function listJobs(state: WorkbenchState, filter: JobFilter): Task[] {
  return [...state.taskIds].reverse().flatMap((id) => {
    const task = state.tasks[id]
    return task && matchesFilter(task, filter) ? [task] : []
  })
}

/** What became of the run's results, in one phrase. */
export function publicationLabel(
  task: Task,
  group: RunGroup | null,
): string | null {
  if (!group) return null
  const held = Object.keys(group.held).length
  switch (group.status) {
    case 'published':
      return task.status === 'succeeded'
        ? 'Published'
        : 'Published by a later attempt'
    case 'open':
      return held > 0
        ? `${held} result${held === 1 ? '' : 's'} held, not published`
        : isActiveStatus(task.status)
          ? 'Not published yet'
          : 'Nothing published'
    case 'cancelled':
      return 'Cancelled; nothing published'
    case 'invalidated':
      return 'Inputs changed; nothing published'
    case 'superseded':
      return 'Replaced by a fresh run'
  }
}

/** Short outcome for a list row. */
export function outcomeLabel(task: Task, plural = 'items'): string {
  const counts = itemCounts(task)
  if (!counts || counts.total === 0) return JOB_STATUS_LABELS[task.status]
  if (task.status === 'failed' && counts.failed > 0) {
    return `${counts.failed} of ${counts.total} ${plural} failed`
  }
  if (isActiveStatus(task.status)) {
    return `${counts.succeeded + counts.failed} of ${counts.total} ${plural}`
  }
  return `${counts.total} ${plural}, ${JOB_STATUS_LABELS[task.status].toLowerCase()}`
}

export function cancelBlocker(
  task: Task,
  pending: PendingRequest[],
): string | null {
  if (!isActiveStatus(task.status)) {
    return `This job is ${JOB_STATUS_LABELS[task.status].toLowerCase()}; only queued or running jobs can be cancelled.`
  }
  return waitingReason(
    pending,
    'task.cancel',
    'the job is being cancelled',
    (input) => (input as { taskId?: unknown }).taskId === task.id,
  )
}

export function retryActionBlocker(
  state: WorkbenchState,
  task: Task,
  pending: PendingRequest[],
): string | null {
  return (
    waitingReason(
      pending,
      'job.retry',
      'the retry is being queued',
      (input) => (input as { taskId?: unknown }).taskId === task.id,
    ) ?? retryBlocker(state, task.id)
  )
}

export function freshRunBlocker(
  state: WorkbenchState,
  task: Task,
  pending: PendingRequest[],
): string | null {
  return (
    waitingReason(
      pending,
      'workflow.runStage',
      'the run is being queued',
      (input) => (input as { stageId?: unknown }).stageId === task.stageId,
    ) ?? stageSubmitBlocker(state, task.stageId)
  )
}

/** The retry button's wording for this job's run. */
export function retryLabel(state: WorkbenchState, task: Task): string {
  const group = groupOf(state, task)
  return group ? retryScope(group) : 'Retry'
}

/** The other attempts of this job's run, oldest first. */
export function attemptsOf(state: WorkbenchState, task: Task): Task[] {
  const group = groupOf(state, task)
  if (!group) return [task]
  return group.attemptIds.flatMap((id) => {
    const attempt = state.tasks[id]
    return attempt ? [attempt] : []
  })
}

/** The job the Jobs page shows: the selected one, else the newest listed. */
export function shownJob(
  state: WorkbenchState,
  selectedTaskId: string | null,
  filter: JobFilter,
): Task | null {
  const selected = selectedTaskId ? state.tasks[selectedTaskId] : undefined
  return selected ?? listJobs(state, filter)[0] ?? null
}
