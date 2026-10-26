import { createStore, type StoreApi } from 'zustand/vanilla'
import { isActiveStatus, itemCounts } from '../../domain/jobs/runGroups.ts'
import type { Task, WorkbenchState } from '../../domain/types.ts'
import type { Workbench } from '../../domain/workbench.ts'

// Completion notices for jobs (jobs rollout plan, D6): project-scoped and
// nonmodal. A notice appears when a job this session saw active finishes; it
// never moves focus and never reaches another project, because the baseline
// resets whenever the project identity changes.

export type JobNoticeTone = 'success' | 'warning' | 'danger'

export type JobNotice = {
  id: string
  projectId: string
  taskId: string
  tone: JobNoticeTone
  message: string
}

export type JobNotices = {
  store: StoreApi<{ notices: JobNotice[] }>
  dismiss: (id: string) => void
  dispose: () => void
}

/** At most this many notices are kept; older ones drop off. */
const LIMIT = 3

function describe(task: Task): { tone: JobNoticeTone; message: string } | null {
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
            message: `${task.label} partly failed: ${counts.failed} of ${counts.total} items failed; successful results are held.`,
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

export function createJobNotices(
  workbench: Workbench,
  session?: SessionGeneration,
): JobNotices {
  const store = createStore<{ notices: JobNotice[] }>()(() => ({
    notices: [],
  }))
  let previous: WorkbenchState = workbench.getState()
  let next = 1
  let generation = session?.getGeneration() ?? 0
  const unsubscribeSession = session?.subscribe(() => {
    const current = session.getGeneration()
    if (current === generation) return
    generation = current
    previous = workbench.getState()
    store.setState({ notices: [] })
  })

  const unsubscribe = workbench.store.subscribe((snapshot) => {
    const state = snapshot.state
    const before = previous
    previous = state
    if (state.tasks === before.tasks) return
    if (state.project.id !== before.project.id) {
      store.setState({ notices: [] })
      return
    }
    const fresh: JobNotice[] = []
    for (const id of state.taskIds) {
      const task = state.tasks[id]
      const earlier = before.tasks[id]
      if (!task || !earlier) continue
      if (!isActiveStatus(earlier.status) || isActiveStatus(task.status))
        continue
      const notice = describe(task)
      if (notice) {
        fresh.push({
          id: `job-notice-${next++}`,
          projectId: state.project.id,
          taskId: task.id,
          ...notice,
        })
      }
    }
    if (fresh.length > 0) {
      store.setState({
        notices: [...fresh.reverse(), ...store.getState().notices].slice(
          0,
          LIMIT,
        ),
      })
    }
  })

  return {
    store,
    dismiss(id) {
      store.setState({
        notices: store.getState().notices.filter((notice) => notice.id !== id),
      })
    },
    dispose() {
      unsubscribe()
      unsubscribeSession?.()
    },
  }
}
