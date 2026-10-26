import { useState } from 'react'
import { sourceKey } from '../../../domain/intake/fusion.ts'
import {
  BUILDING_ITEM_STAGES,
  groupOf,
  itemNoun,
} from '../../../domain/jobs/runGroups.ts'
import type { Task, WorkbenchState } from '../../../domain/types.ts'
import { STAGE_IDS } from '../../../domain/workflow.ts'
import { useServices } from '../../WorkbenchContext.tsx'
import componentStyles from '../../components/components.module.css'
import styles from './jobs.module.css'

const PAGE_SIZE = 25

/**
 * The failed items of one attempt, with their reasons. Building items, and
 * fusion records that match a building, can be selected on the map and table.
 */
export function JobItems({
  task,
  state,
}: {
  task: Task
  state: WorkbenchState
}) {
  const { client, showInspection } = useServices()
  const [shown, setShown] = useState(PAGE_SIZE)
  const failures = Object.entries(task.items?.failures ?? {})
  if (failures.length === 0) return null
  const group = groupOf(state, task)
  const fusion = group?.kind === 'fusion'
  const title = `Failed ${itemNoun(group)}`
  const bySource = new Map<string, string>()
  if (fusion) {
    for (const id of state.buildingIds) {
      const ref = state.buildings[id]?.sourceRef
      if (ref) bySource.set(sourceKey(ref), id)
    }
  }
  const buildings = group ? BUILDING_ITEM_STAGES.has(group.stageId) : false
  const buildingOf = (id: string) =>
    fusion ? (bySource.get(id) ?? null) : buildings ? id : null
  const selectable = failures.flatMap(([id]) => {
    const building = buildingOf(id)
    return building ? [building] : []
  })
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
    <section aria-label={title} className={styles.section}>
      <div className={styles.sectionHeader}>
        <h4>{title}</h4>
        {selectable.length > 0 ? (
          <button
            type="button"
            className={componentStyles.button}
            onClick={() => select(selectable)}
          >
            Select {selectable.length} failed building
            {selectable.length === 1 ? '' : 's'}
          </button>
        ) : null}
      </div>
      <table className={componentStyles.table} aria-label={title}>
        <thead>
          <tr>
            <th scope="col">
              {fusion ? 'Source ID' : buildings ? 'Building' : 'Item'}
            </th>
            <th scope="col">Reason</th>
            <th scope="col">
              <span className="visually-hidden">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {visible.map(([id, reason]) => {
            const building = buildingOf(id)
            return (
              <tr key={id}>
                <td>
                  {group?.stageId === STAGE_IDS.scenarioModeling
                    ? (state.scenarios[id]?.name ?? id)
                    : id}
                </td>
                <td>{reason}</td>
                <td>
                  {building ? (
                    <button
                      type="button"
                      className={componentStyles.button}
                      aria-label={`Select building ${building}`}
                      onClick={() => select([building])}
                    >
                      Select
                    </button>
                  ) : null}
                </td>
              </tr>
            )
          })}
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
