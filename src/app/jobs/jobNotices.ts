import {
  groupOf,
  isActiveStatus,
  itemCounts,
  itemNoun,
} from '../../domain/jobs/runGroups.ts'
import type { Task, WorkbenchState } from '../../domain/types.ts'
import type { Workbench } from '../../domain/workbench.ts'

// Completion notices for jobs (jobs rollout plan, D6): project-scoped and
// nonmodal. A notice is raised when a job this session saw active finishes; it
// never reaches another project, because the baseline resets whenever the
// project identity changes. The message center (decision 0027) keeps them.

export type JobNoticeTone = 'success' | 'warning' | 'danger'

export type JobNotice = {
  projectId: string
  taskId: string
  tone: JobNoticeTone
  message: string
}

function describe(
  task: Task,
  state: WorkbenchState,
): { tone: JobNoticeTone; message: string } | null {
  const counts = itemCounts(task)
  switch (task.status) {
    case 'succeeded':
      return {
        tone: 'success',
        message: `${task.label} completed${task.attempt > 1 ? ` on attempt ${task.attempt}` : ''}.`,
      }
    case 'failed':
      return counts && counts.failed > 0
        ? {
            tone: 'warning',
            message: `${task.label} partly failed: ${counts.failed} of ${counts.total} ${itemNoun(groupOf(state, task))} failed; successful results are held.`,
          }
        : { tone: 'danger', message: `${task.label} failed.` }
    case 'invalidated':
      return {
        tone: 'warning',
        message: `${task.label} did not run because its inputs changed.`,
      }
    default:
      return null
  }
}

/** The client's project session generation, which changes with every replacement. */
export type SessionGeneration = {
  getGeneration: () => number
  subscribe: (listener: () => void) => () => void
}

/**
 * Calls `onNotice` for every job that finishes after this session saw it
 * active, oldest first; returns a function that stops watching.
 */
export function watchJobCompletions(
  workbench: Workbench,
  onNotice: (notice: JobNotice) => void,
  session?: SessionGeneration,
): () => void {
  let previous: WorkbenchState = workbench.getState()
  let generation = session?.getGeneration() ?? 0
  const unsubscribeSession = session?.subscribe(() => {
    const current = session.getGeneration()
    if (current === generation) return
    generation = current
    previous = workbench.getState()
  })

  const unsubscribe = workbench.store.subscribe((snapshot) => {
    const state = snapshot.state
    const before = previous
    previous = state
    if (state.tasks === before.tasks) return
    if (state.project.id !== before.project.id) return
    for (const id of state.taskIds) {
      const task = state.tasks[id]
      const earlier = before.tasks[id]
      if (!task || !earlier) continue
      if (!isActiveStatus(earlier.status) || isActiveStatus(task.status))
        continue
      const notice = describe(task, state)
      if (notice) {
        onNotice({ projectId: state.project.id, taskId: task.id, ...notice })
      }
    }
  })

  return () => {
    unsubscribe()
    unsubscribeSession?.()
  }
}
