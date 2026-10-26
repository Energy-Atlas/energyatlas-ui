import { useId } from 'react'
import type { Task, TaskStatus } from '../../domain/types.ts'
import {
  useClientSnapshot,
  useServices,
  useWorkbenchSnapshot,
} from '../WorkbenchContext.tsx'
import { ActionButton } from '../components/ActionButton.tsx'
import styles from '../components/components.module.css'
import { waitingReason } from '../service/usePendingReason.ts'
import pageStyles from './pages.module.css'

/** RC's job states (decision 0023) for the stage tasks the server runs. */
export const JOB_STATUS_LABELS: Record<TaskStatus, string> = {
  queued: 'Created',
  running: 'Running',
  succeeded: 'Completed',
  failed: 'Failed',
  cancelled: 'Cancelled',
  invalidated: 'Not run',
}

function JobLog({ task }: { task: Task }) {
  return (
    <details className={pageStyles.jobLog}>
      <summary>
        Log <span className={styles.muted}>({task.log.length})</span>
      </summary>
      <ol aria-label={`Log of ${task.label}`}>
        {task.log.map((line, index) => (
          <li key={index}>
            <time dateTime={line.at}>
              {new Date(line.at).toLocaleTimeString()}
            </time>{' '}
            {line.message}
          </li>
        ))}
      </ol>
    </details>
  )
}

/** The server's jobs: one per stage run, with its state, progress, and log. */
export function TasksPage() {
  const headingId = useId()
  const { client } = useServices()
  const tasks = useWorkbenchSnapshot((snapshot) => snapshot.state.tasks)
  const taskIds = useWorkbenchSnapshot((snapshot) => snapshot.state.taskIds)
  const pending = useClientSnapshot((snapshot) => snapshot.pending)
  const ordered = [...taskIds].reverse().flatMap((id) => {
    const task = tasks[id]
    return task ? [task] : []
  })

  return (
    <section className={styles.page} aria-labelledby={headingId}>
      <h2 id={headingId}>Jobs</h2>
      {ordered.length === 0 ? (
        <p className={styles.empty}>
          No jobs yet. Run a workflow stage to start one.
        </p>
      ) : (
        <table className={styles.table} aria-label="Jobs">
          <thead>
            <tr>
              <th scope="col">Job</th>
              <th scope="col">Status</th>
              <th scope="col">Progress</th>
              <th scope="col">Started by</th>
              <th scope="col">Message</th>
              <th scope="col">Log</th>
              <th scope="col">
                <span className="visually-hidden">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {ordered.map((task) => {
              const active =
                task.status === 'queued' || task.status === 'running'
              return (
                <tr key={task.id}>
                  <td>{task.label}</td>
                  <td>{JOB_STATUS_LABELS[task.status]}</td>
                  <td>{Math.round(task.progress * 100)}%</td>
                  <td>{task.source}</td>
                  <td>{task.message ?? ''}</td>
                  <td>
                    <JobLog task={task} />
                  </td>
                  <td>
                    {active ? (
                      <ActionButton
                        label={`Cancel ${task.label}`}
                        disabledReason={waitingReason(
                          pending,
                          'task.cancel',
                          'the job is being cancelled',
                          (input) =>
                            (input as { taskId?: unknown }).taskId === task.id,
                        )}
                        onPress={() =>
                          void client.execute({
                            type: 'task.cancel',
                            input: { taskId: task.id },
                          })
                        }
                      >
                        Cancel
                      </ActionButton>
                    ) : null}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      )}
    </section>
  )
}
