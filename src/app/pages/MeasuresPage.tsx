import { Plus } from 'lucide-react'
import { useId } from 'react'
import { capabilities } from '../../domain/capabilities.ts'
import {
  MEASURE_LIBRARY,
  type LibraryMeasure,
} from '../../domain/scenarios/library.ts'
import type { Measure, Scenario, SelectableEntity } from '../../domain/types.ts'
import {
  useClientSnapshot,
  useServices,
  useWorkbenchSnapshot,
} from '../WorkbenchContext.tsx'
import { ActionButton } from '../components/ActionButton.tsx'
import { CapabilityBadge, StatusTag } from '../components/CapabilityBadge.tsx'
import { PanelHeader } from '../components/PanelHeader.tsx'
import { WorkbenchTable } from '../components/WorkbenchTable.tsx'
import componentStyles from '../components/components.module.css'
import {
  appliesToLabel,
  measureKindLabel,
  sourceLabel,
} from '../properties/definitionLabels.ts'
import type { DefinitionKind } from '../properties/propertiesService.ts'
import { waitingReason } from '../service/usePendingReason.ts'
import type { DataColumn } from '../tables/tableModel.ts'
import { ScenarioComparison } from './ScenarioComparison.tsx'
import styles from './measures.module.css'

/** Columns a project measure and a library measure share. */
function measureColumns<
  Row extends Omit<Measure, 'id' | 'source'>,
>(): DataColumn<Row>[] {
  return [
    {
      id: 'name',
      header: 'Name',
      value: (measure) => measure.name,
      rowHeader: true,
    },
    {
      id: 'kind',
      header: 'Kind',
      value: (measure) => measureKindLabel(measure.kind),
      type: 'enum',
    },
    {
      id: 'savings',
      header: 'Savings',
      value: (measure) =>
        measure.kind === 'pv' ? null : measure.savingsPercent,
      type: 'number',
      unit: '%',
      decimals: 1,
      empty: 'From PV yield',
    },
    {
      id: 'appliesTo',
      header: 'Applies to',
      value: (measure) => appliesToLabel(measure.appliesTo),
      type: 'enum',
    },
  ]
}

/**
 * Measures and scenarios (decision 0028; formerly the Creator page): the
 * project's measures, the synthetic measure library, and the scenarios as
 * tables. Choosing a row shows it in Properties, where it is edited; New
 * starts a blank one there. The comparison reads published results.
 */
export function MeasuresPage() {
  const headingId = useId()
  const { client, workbench, properties, showInspection } = useServices()
  const state = useWorkbenchSnapshot((snapshot) => snapshot.state)
  const pending = useClientSnapshot((snapshot) => snapshot.pending)
  const measures = Object.values(state.measures)
  const scenarios = Object.values(state.scenarios)
  const { selection } = state
  const names = new Set(measures.map((measure) => measure.name.toLowerCase()))
  const addBlocker = waitingReason(
    pending,
    'measure.addFromLibrary',
    'the measure is being added',
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

  const projectColumns: DataColumn<Measure>[] = [
    ...measureColumns<Measure>(),
    {
      id: 'usedBy',
      header: 'Used by scenarios',
      value: (measure) =>
        scenarios.filter((scenario) => scenario.measureIds.includes(measure.id))
          .length,
      type: 'number',
    },
    {
      id: 'source',
      header: 'Source',
      value: (measure) => sourceLabel(measure.source),
      type: 'enum',
    },
  ]

  const libraryColumns: DataColumn<LibraryMeasure>[] = [
    ...measureColumns<LibraryMeasure>(),
    {
      id: 'description',
      header: 'Description',
      value: (entry) => entry.description,
      wrap: true,
    },
    {
      id: 'inProject',
      header: 'In project',
      value: (entry) => (names.has(entry.name.toLowerCase()) ? 'Yes' : 'No'),
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
            names.has(entry.name.toLowerCase())
              ? 'Already in the project.'
              : addBlocker
          }
          onPress={() =>
            void client
              .execute({
                type: 'measure.addFromLibrary',
                input: { libraryId: entry.libraryId },
              })
              .then((result) => {
                if (result.outcome.status !== 'applied') return
                const added = Object.values(workbench.getState().measures).find(
                  (measure) => measure.name === entry.name,
                )
                if (added) choose('measure')(added.id)
              })
          }
        >
          Add
        </ActionButton>
      ),
    },
  ]

  const scenarioColumns: DataColumn<Scenario>[] = [
    {
      id: 'name',
      header: 'Name',
      value: (scenario) => scenario.name,
      rowHeader: true,
    },
    {
      id: 'measures',
      header: 'Measures',
      wrap: true,
      value: (scenario) =>
        scenario.measureIds
          .map((id) => state.measures[id]?.name ?? id)
          .join(', '),
    },
    {
      id: 'measureCount',
      header: 'Measure count',
      value: (scenario) => scenario.measureIds.length,
      type: 'number',
    },
    {
      id: 'adoption',
      header: 'Adoption',
      value: (scenario) => scenario.adoptionPercent,
      type: 'number',
      unit: '%',
    },
    {
      id: 'comparison',
      header: 'Comparison',
      value: (scenario) => (scenario.included ? 'Included' : 'Left out'),
      type: 'enum',
    },
  ]

  return (
    <section
      className={`${componentStyles.page} ${styles.page}`}
      aria-labelledby={headingId}
    >
      <PanelHeader
        title="Measures and scenarios"
        headingId={headingId}
        meta={<CapabilityBadge id="creator.measure" />}
        description="Choose a row to see and edit it in Properties. Scenario modeling compares the scenarios included in the comparison set."
      />

      <section className={styles.section} aria-label="Project measures">
        <h3 className={styles.sectionTitle}>Project measures</h3>
        <WorkbenchTable
          id="creator.measures"
          aria-label="Measures"
          columns={projectColumns}
          rows={measures}
          rowKey={(measure) => measure.id}
          className={styles.table}
          emptyText="No measures yet. Add one from the library or create one."
          search={{ label: 'Search measures', placeholder: 'Search measures' }}
          barStart={
            <ActionButton
              label="New measure"
              disabledReason={null}
              onPress={() => create('measure')}
            >
              <Plus size={14} aria-hidden="true" /> New measure
            </ActionButton>
          }
          selection={{
            selectedKey: selectedOf('measure'),
            onSelect: choose('measure'),
          }}
        />
      </section>

      <section className={styles.section} aria-label="Measure library">
        <h3 className={styles.sectionTitle}>Measure library</h3>
        <WorkbenchTable
          id="creator.measureLibrary"
          aria-label="Measure library"
          columns={libraryColumns}
          rows={[...MEASURE_LIBRARY]}
          rowKey={(entry) => entry.libraryId}
          className={styles.table}
          search={{
            label: 'Search the measure library',
            placeholder: 'Search the library',
          }}
          exportable={false}
        />
      </section>

      <section className={styles.section} aria-label="Scenarios">
        <h3 className={styles.sectionTitle}>Scenarios</h3>
        <WorkbenchTable
          id="creator.scenarios"
          aria-label="Scenarios"
          columns={scenarioColumns}
          rows={scenarios}
          rowKey={(scenario) => scenario.id}
          className={styles.table}
          emptyText="No scenarios yet. A scenario combines measures at an adoption level."
          search={{
            label: 'Search scenarios',
            placeholder: 'Search scenarios',
          }}
          barStart={
            <ActionButton
              label="New scenario"
              disabledReason={null}
              onPress={() => create('scenario')}
            >
              <Plus size={14} aria-hidden="true" /> New scenario
            </ActionButton>
          }
          selection={{
            selectedKey: selectedOf('scenario'),
            onSelect: choose('scenario'),
          }}
        />
      </section>

      <ScenarioComparison />

      <p className={styles.planned}>
        <StatusTag status="planned" />{' '}
        {capabilities['creator.otherAssets'].explanation}
      </p>
    </section>
  )
}
