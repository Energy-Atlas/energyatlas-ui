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
import { WorkbenchTable } from '../../components/WorkbenchTable.tsx'
import type { DataColumn } from '../../tables/tableModel.ts'
import styles from './jobs.module.css'

const PAGE_SIZE = 25

type FailedItem = {
  id: string
  label: string
  reason: string
  building: string | null
}

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
  const items: FailedItem[] = failures.map(([id, reason]) => ({
    id,
    label:
      group?.stageId === STAGE_IDS.scenarioModeling
        ? (state.scenarios[id]?.name ?? id)
        : id,
    reason,
    building: buildingOf(id),
  }))

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

  const columns: DataColumn<FailedItem>[] = [
    {
      id: 'item',
      header: fusion ? 'Source ID' : buildings ? 'Building' : 'Item',
      value: (item) => item.label,
      type: 'identifier',
      rowHeader: true,
      width: 140,
    },
    {
      id: 'reason',
      header: 'Reason',
      value: (item) => item.reason,
      wrap: true,
    },
    {
      id: 'actions',
      header: 'Actions',
      value: () => null,
      action: true,
      width: 90,
      render: ({ building }) =>
        building ? (
          <button
            type="button"
            className={componentStyles.button}
            aria-label={`Select building ${building}`}
            onClick={() => select([building])}
          >
            Select
          </button>
        ) : null,
    },
  ]

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
      <WorkbenchTable
        id="jobs.failedItems"
        aria-label={title}
        columns={columns}
        rows={items}
        rowKey={(item) => item.id}
        pageSize={PAGE_SIZE}
        exportContext={[`job: ${task.label}, attempt ${task.attempt}`]}
      />
    </section>
  )
}
