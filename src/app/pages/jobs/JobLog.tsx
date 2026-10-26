import type { Task } from '../../../domain/types.ts'
import styles from './jobs.module.css'

/** A job's retained log, oldest first, in the mono face of the operation log. */
export function JobLog({ task }: { task: Task }) {
  return (
    <div className={styles.log} tabIndex={0} aria-label="Job log">
      <ol aria-label={`Log of ${task.label}, attempt ${task.attempt}`}>
        {task.log.map((line, index) => (
          <li key={index}>
            <time dateTime={line.at}>
              {new Date(line.at).toLocaleTimeString()}
            </time>{' '}
            {line.message}
          </li>
        ))}
      </ol>
    </div>
  )
}
