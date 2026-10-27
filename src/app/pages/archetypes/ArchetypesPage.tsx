import { Plus } from 'lucide-react'
import { useId, useMemo } from 'react'
import {
  previewAssignment,
  scheduleStats,
  type CoverageRow,
} from '../../../domain/archetypes/assignment.ts'
import {
  ARCHETYPE_LIBRARY,
  SCHEDULE_LIBRARY,
} from '../../../domain/archetypes/library.ts'
import { stageSubmitBlocker } from '../../../domain/commands.ts'
import type {
  Archetype,
  Schedule,
  SelectableEntity,
} from '../../../domain/types.ts'
import { STAGE_IDS } from '../../../domain/workflow.ts'
import {
  useClientSnapshot,
  useServices,
  useStageStates,
  useWorkbenchSnapshot,
} from '../../WorkbenchContext.tsx'
import { ActionButton } from '../../components/ActionButton.tsx'
import { CapabilityBadge } from '../../components/CapabilityBadge.tsx'
import { PanelHeader } from '../../components/PanelHeader.tsx'
import { StateBadge } from '../../components/StateBadge.tsx'
import { WorkbenchTable } from '../../components/WorkbenchTable.tsx'
import componentStyles from '../../components/components.module.css'
import {
  USE_LABELS,
  rangeLabel,
  sourceLabel,
} from '../../properties/definitionLabels.ts'
import type { DefinitionKind } from '../../properties/propertiesService.ts'
import { waitingReason } from '../../service/usePendingReason.ts'
import type { DataColumn } from '../../tables/tableModel.ts'
import styles from './archetypes.module.css'

const COVERAGE_COLUMNS: DataColumn<CoverageRow>[] = [
  {
    id: 'use',
    header: 'Use',
    value: (row) =>
      row.use === 'unknown' ? 'Use not known' : USE_LABELS[row.use],
    rowHeader: true,
  },
  {
    id: 'buildings',
    header: 'Buildings',
    value: (row) => row.buildings,
    type: 'number',
  },
  {
    id: 'assigned',
    header: 'Assigned',
    value: (row) => row.assigned,
    type: 'number',
  },
  {
    id: 'unassigned',
    header: 'Unassigned',
    value: (row) => row.unassigned,
    type: 'number',
  },
  {
    id: 'overridden',
    header: 'Manual overrides',
    value: (row) => row.overridden,
    type: 'number',
  },
]

/** Columns every archetype table shares: what it covers and its intensity. */
function definitionColumns(
  schedules: Record<string, Pick<Schedule, 'name'>>,
): DataColumn<Archetype>[] {
  return [
    {
      id: 'name',
      header: 'Name',
      value: (archetype) => archetype.name,
      rowHeader: true,
    },
    {
      id: 'use',
      header: 'Use',
      value: (archetype) => USE_LABELS[archetype.use],
      type: 'enum',
    },
    {
      id: 'years',
      header: 'Years',
      value: (archetype) => rangeLabel(archetype),
      type: 'enum',
    },
    {
      id: 'yearFrom',
      header: 'Built from',
      value: (archetype) => archetype.yearFrom,
      type: 'number',
      grouping: false,
      empty: 'Open',
    },
    {
      id: 'yearTo',
      header: 'Built to',
      value: (archetype) => archetype.yearTo,
      type: 'number',
      grouping: false,
      empty: 'Open',
    },
    {
      id: 'eui',
      header: 'Energy use intensity',
      value: (archetype) => archetype.euiKwhPerM2,
      type: 'number',
      unit: 'kWh/m²',
    },
    {
      id: 'schedule',
      header: 'Schedule',
      value: (archetype) =>
        archetype.scheduleId
          ? (schedules[archetype.scheduleId]?.name ?? archetype.scheduleId)
          : null,
      type: 'enum',
      empty: 'None',
    },
  ]
}

/**
 * Archetypes and schedules (jobs rollout plan, slice 5; decision 0028): the
 * project's archetypes, the synthetic library, and the schedules as tables
 * to search, filter, and sort. Choosing a row shows it in the Properties
 * panel, where it is edited; New starts a blank one there. Assignment runs
 * as a job, previewed by the coverage table.
 */
export function ArchetypesPage() {
  const headingId = useId()
  const { client, workbench, properties, showInspection } = useServices()
  const state = useWorkbenchSnapshot((snapshot) => snapshot.state)
  const pending = useClientSnapshot((snapshot) => snapshot.pending)
  const stageStates = useStageStates()
  const archetypes = Object.values(state.archetypes)
  const schedules = Object.values(state.schedules)
  const preview = useMemo(() => previewAssignment(state), [state])
  const { selection } = state
  const runBlocker =
    waitingReason(
      pending,
      'workflow.runStage',
      'the run is being queued',
      (input) =>
        (input as { stageId?: unknown }).stageId === STAGE_IDS.archetypes,
    ) ?? stageSubmitBlocker(state, STAGE_IDS.archetypes)
  const addBlocker = waitingReason(
    pending,
    'archetype.addFromLibrary',
    'the archetype is being added',
  )

  const selectedOf = (entityType: SelectableEntity) =>
    selection.entityType === entityType ? (selection.ids[0] ?? null) : null
  const choose = (entityType: SelectableEntity) => (id: string) => {
    workbench.execute({
      type: 'selection.set',
      input: { entityType, ids: [id] },
    })
    showInspection()
  }
  const create = (kind: DefinitionKind) => {
    properties.startCreate(kind)
    showInspection()
  }

  const archetypeColumns: DataColumn<Archetype>[] = [
    ...definitionColumns(state.schedules),
    {
      id: 'buildings',
      header: 'Buildings',
      value: (archetype) => preview.byArchetype[archetype.id] ?? 0,
      type: 'number',
    },
    {
      id: 'source',
      header: 'Source',
      value: (archetype) => sourceLabel(archetype.source),
      type: 'enum',
    },
  ]

  const libraryColumns: DataColumn<Archetype>[] = [
    // Library rows name the library schedule they would bring.
    ...definitionColumns(
      Object.fromEntries(
        SCHEDULE_LIBRARY.map((schedule) => [schedule.id, schedule]),
      ),
    ),
    {
      id: 'inProject',
      header: 'In project',
      value: (entry) => (state.archetypes[entry.id] ? 'Yes' : 'No'),
      type: 'enum',
    },
    {
      id: 'add',
      header: 'Add',
      value: () => null,
      action: true,
      width: 96,
      render: (entry) => (
        <ActionButton
          label={`Add ${entry.name} to the project`}
          disabledReason={
            state.archetypes[entry.id] ? 'Already in the project.' : addBlocker
          }
          onPress={() =>
            void client
              .execute({
                type: 'archetype.addFromLibrary',
                input: { libraryId: entry.id },
              })
              .then((result) => {
                if (result.outcome.status === 'applied') {
                  choose('archetype')(entry.id)
                }
              })
          }
        >
          Add
        </ActionButton>
      ),
    },
  ]

  const scheduleColumns: DataColumn<Schedule>[] = [
    {
      id: 'name',
      header: 'Name',
      value: (schedule) => schedule.name,
      rowHeader: true,
    },
    {
      id: 'dayTypes',
      header: 'Day types',
      value: (schedule) => schedule.days.map((day) => day.name).join(', '),
      wrap: true,
    },
    {
      id: 'average',
      header: 'Annual average',
      value: (schedule) => scheduleStats(schedule).annualAverage,
      type: 'number',
      decimals: 3,
    },
    {
      id: 'annualHours',
      header: 'Full-load hours a year',
      value: (schedule) => scheduleStats(schedule).annualHours,
      type: 'number',
      unit: 'h',
    },
    {
      id: 'usedBy',
      header: 'Used by archetypes',
      value: (schedule) =>
        archetypes.filter((archetype) => archetype.scheduleId === schedule.id)
          .length,
      type: 'number',
    },
    {
      id: 'source',
      header: 'Source',
      value: (schedule) => sourceLabel(schedule.source),
      type: 'enum',
    },
  ]

  return (
    <section
      className={`${componentStyles.page} ${styles.page}`}
      aria-labelledby={headingId}
    >
      <PanelHeader
        className={styles.header}
        title="Archetypes and schedules"
        headingId={headingId}
        meta={<CapabilityBadge id="archetypes.library" />}
        actions={
          <span className={styles.stage}>
            Archetype modeling{' '}
            <StateBadge state={stageStates[STAGE_IDS.archetypes] ?? 'future'} />
          </span>
        }
        description="Choose a row to see and edit it in Properties. Saved changes outdate Archetype modeling; buildings change when assignment runs again."
      />

      <section className={styles.section} aria-label="Project archetypes">
        <h3 className={styles.sectionTitle}>Project archetypes</h3>
        <WorkbenchTable
          id="archetypes.definitions"
          aria-label="Project archetypes"
          columns={archetypeColumns}
          rows={archetypes}
          rowKey={(archetype) => archetype.id}
          className={styles.table}
          emptyText="No archetypes yet. The first Archetype modeling run adds the default library archetypes the project lacks; you can also add or create archetypes first."
          search={{
            label: 'Search project archetypes',
            placeholder: 'Search archetypes',
          }}
          barStart={
            <ActionButton
              label="New archetype"
              disabledReason={null}
              onPress={() => create('archetype')}
            >
              <Plus size={14} aria-hidden="true" /> New archetype
            </ActionButton>
          }
          selection={{
            selectedKey: selectedOf('archetype'),
            onSelect: choose('archetype'),
          }}
          exportable={false}
        />
      </section>

      <section className={styles.section} aria-label="Synthetic library">
        <h3 className={styles.sectionTitle}>Synthetic library</h3>
        <WorkbenchTable
          id="archetypes.library"
          aria-label="Synthetic library"
          columns={libraryColumns}
          rows={[...ARCHETYPE_LIBRARY]}
          rowKey={(entry) => entry.id}
          className={styles.table}
          search={{
            label: 'Search the synthetic library',
            placeholder: 'Search the library',
          }}
          exportable={false}
        />
      </section>

      <section className={styles.section} aria-label="Schedules">
        <h3 className={styles.sectionTitle}>Schedules</h3>
        <WorkbenchTable
          id="archetypes.schedules"
          aria-label="Schedules"
          columns={scheduleColumns}
          rows={schedules}
          rowKey={(schedule) => schedule.id}
          className={styles.table}
          emptyText="No schedules yet. Library archetypes bring their schedules; you can also create one."
          search={{
            label: 'Search schedules',
            placeholder: 'Search schedules',
          }}
          barStart={
            <ActionButton
              label="New schedule"
              disabledReason={null}
              onPress={() => create('schedule')}
            >
              <Plus size={14} aria-hidden="true" /> New schedule
            </ActionButton>
          }
          selection={{
            selectedKey: selectedOf('schedule'),
            onSelect: choose('schedule'),
          }}
          exportable={false}
        />
      </section>

      <section aria-label="Assignment coverage" className={styles.section}>
        <h3 className={styles.sectionTitle}>Assignment coverage</h3>
        <p>
          With the current definitions, {preview.assigned} buildings get an
          archetype and {preview.unassigned} get none; {preview.changes}{' '}
          assignments would change and {preview.overrides} manual overrides are
          kept.
        </p>
        {preview.rows.length > 0 ? (
          <WorkbenchTable
            id="archetypes.coverage"
            aria-label="Assignment coverage"
            columns={COVERAGE_COLUMNS}
            rows={preview.rows}
            rowKey={(row) => row.use}
          />
        ) : (
          <p className={componentStyles.empty}>
            No buildings yet. Run the workflow from Location setup first.
          </p>
        )}
        <div className={styles.formActions}>
          <ActionButton
            label="Run Archetype modeling to assign buildings"
            variant="primary"
            disabledReason={runBlocker}
            onPress={() =>
              void client.execute({
                type: 'workflow.runStage',
                input: { stageId: STAGE_IDS.archetypes },
              })
            }
          >
            Run assignment
          </ActionButton>
          <span className={componentStyles.muted}>
            Assignment runs as a job; buildings change only when every building
            has been assigned.
          </span>
        </div>
      </section>
    </section>
  )
}
