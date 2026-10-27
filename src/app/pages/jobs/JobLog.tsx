import type { Task } from '../../../domain/types.ts'
import { LogView } from '../../components/LogView.tsx'
import { jobLogLevel } from './jobView.ts'
import styles from './jobs.module.css'

/** A job's retained log, oldest first, following the newest line. */
export function JobLog({ task }: { task: Task }) {
  return (
    <LogView
      aria-label="Job log"
      listLabel={`Log of ${task.label}, attempt ${task.attempt}`}
      className={styles.log}
      entries={task.log.map((line, index) => ({
        id: String(index),
        at: line.at,
        level: jobLogLevel(line.message),
        text: line.message,
      }))}
      levelFilter
      follow
      download={{ fileName: `${task.label} attempt ${task.attempt} log` }}
      empty="No log lines yet."
    />
  )
}
