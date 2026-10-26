import { useState } from 'react'
import type { Task } from '../../../domain/types.ts'
import { useServices } from '../../WorkbenchContext.tsx'
import componentStyles from '../../components/components.module.css'
import styles from './jobs.module.css'

const PAGE_SIZE = 25

/** The failed items of one attempt, with their reasons; each can be selected on the map and table. */
export function JobItems({ task }: { task: Task }) {
  const { client, showInspection } = useServices()
  const [shown, setShown] = useState(PAGE_SIZE)
  const failures = Object.entries(task.items?.failures ?? {})
  if (failures.length === 0) return null
  const visible = failures.slice(0, shown)

  function select(ids: string[]) {
    void client
      .execute({
        type: 'selection.set',
        input: { entityType: 'building', ids },
      })
      .then((result) => {
        if (result.outcome.status === 'applied') showInspection()
      })
  }

  return (
    <section aria-label="Failed items" className={styles.section}>
      <div className={styles.sectionHeader}>
        <h4>Failed items</h4>
        <button
          type="button"
          className={componentStyles.button}
          onClick={() => select(failures.map(([id]) => id))}
        >
          Select {failures.length} failed building
          {failures.length === 1 ? '' : 's'}
        </button>
      </div>
      <table className={componentStyles.table} aria-label="Failed items">
        <thead>
          <tr>
            <th scope="col">Building</th>
            <th scope="col">Reason</th>
            <th scope="col">
              <span className="visually-hidden">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {visible.map(([id, reason]) => (
            <tr key={id}>
              <td>{id}</td>
              <td>{reason}</td>
              <td>
                <button
                  type="button"
                  className={componentStyles.button}
                  aria-label={`Select building ${id}`}
                  onClick={() => select([id])}
                >
                  Select
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {failures.length > shown ? (
        <p className={styles.more}>
          Showing {shown} of {failures.length}.{' '}
          <button
            type="button"
            className={componentStyles.button}
            onClick={() => setShown(shown + PAGE_SIZE)}
          >
            Show {Math.min(PAGE_SIZE, failures.length - shown)} more
          </button>
        </p>
      ) : null}
    </section>
  )
}
