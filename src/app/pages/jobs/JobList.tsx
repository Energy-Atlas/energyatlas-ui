import type { Task } from '../../../domain/types.ts'
import { useServices } from '../../WorkbenchContext.tsx'
import { SelectableList } from '../../components/SelectableList.tsx'
import { formatTime } from '../../format.ts'
import { JobStatusBadge } from './JobStatusBadge.tsx'
import { JOB_STATUS_LABELS, outcomeLabel } from './jobView.ts'
import styles from './jobs.module.css'

/** Jobs newest first; arrow keys move the selection, which the detail pane follows. */
export function JobList({
  jobs,
  selectedId,
  nounOf,
}: {
  jobs: Task[]
  selectedId: string | null
  /** What each job's items are called, such as items or records. */
  nounOf: (task: Task) => string
}) {
  const { view } = useServices()
  return (
    <SelectableList
      aria-label="Jobs"
      className={styles.list}
      items={jobs.map((task) => ({
        id: task.id,
        title: task.label,
        status: <JobStatusBadge status={task.status} />,
        meta: (
          <>
            Attempt {task.attempt} · {outcomeLabel(task, nounOf(task))} ·{' '}
            <time dateTime={task.updatedAt}>{formatTime(task.updatedAt)}</time>
          </>
        ),
        description: `attempt ${task.attempt}, ${JOB_STATUS_LABELS[task.status]}`,
      }))}
      selectedId={selectedId}
      onSelect={(taskId) =>
        view.execute({ type: 'jobs.select', input: { taskId } })
      }
    />
  )
}
