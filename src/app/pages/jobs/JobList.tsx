import { ListBox, ListBoxItem } from 'react-aria-components'
import type { Task } from '../../../domain/types.ts'
import { useServices } from '../../WorkbenchContext.tsx'
import componentStyles from '../../components/components.module.css'
import { JobStatusBadge } from './JobStatusBadge.tsx'
import { JOB_STATUS_LABELS, outcomeLabel } from './jobView.ts'
import styles from './jobs.module.css'

/** Jobs newest first; arrow keys move the selection, which the detail pane follows. */
export function JobList({
  jobs,
  selectedId,
}: {
  jobs: Task[]
  selectedId: string | null
}) {
  const { view } = useServices()
  return (
    <ListBox
      aria-label="Jobs"
      className={styles.list}
      items={jobs}
      selectionMode="single"
      selectionBehavior="replace"
      disallowEmptySelection
      selectedKeys={selectedId ? [selectedId] : []}
      onSelectionChange={(keys) => {
        if (keys === 'all') return
        const [key] = [...keys]
        if (typeof key === 'string' && key !== selectedId) {
          view.execute({ type: 'jobs.select', input: { taskId: key } })
        }
      }}
    >
      {(task) => (
        <ListBoxItem
          id={task.id}
          className={styles.row}
          textValue={`${task.label}, attempt ${task.attempt}, ${JOB_STATUS_LABELS[task.status]}`}
        >
          <span className={styles.rowTitle}>{task.label}</span>
          <span className={styles.rowMeta}>
            <JobStatusBadge status={task.status} />
            <span className={componentStyles.muted}>
              Attempt {task.attempt} · {outcomeLabel(task)} ·{' '}
              <time dateTime={task.updatedAt}>
                {new Date(task.updatedAt).toLocaleTimeString()}
              </time>
            </span>
          </span>
        </ListBoxItem>
      )}
    </ListBox>
  )
}
