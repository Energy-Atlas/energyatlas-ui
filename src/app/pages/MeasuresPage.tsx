import { Plus } from 'lucide-react'
import { useId, useMemo } from 'react'
import { capabilities } from '../../domain/capabilities.ts'
import { stageSubmitBlocker } from '../../domain/commands.ts'
import { isActiveStatus } from '../../domain/jobs/runGroups.ts'
import {
  CONDITION_FIELDS,
  describeConditions,
} from '../../domain/rules/conditions.ts'
import {
  MEASURE_LIBRARY,
  type LibraryMeasure,
} from '../../domain/scenarios/library.ts'
import {
  KIND_LABELS,
  kindNoun,
  previewScenarioRules,
  scenarioMeasureIds,
  scenarioRules,
} from '../../domain/scenarios/rules.ts'
import type {
  Measure,
  MeasureKind,
  Scenario,
  SelectableEntity,
} from '../../domain/types.ts'
import { MEASURE_KINDS } from '../../domain/types.ts'
import { STAGE_IDS } from '../../domain/workflow.ts'
import {
  useClientSnapshot,
  useServices,
  useStageStates,
  useViewState,
  useWorkbenchSnapshot,
} from '../WorkbenchContext.tsx'
import { ActionButton, useRecordBlocked } from '../components/ActionButton.tsx'
import { CapabilityBadge, StatusTag } from '../components/CapabilityBadge.tsx'
import { InlineAlert } from '../components/InlineAlert.tsx'
import { PanelHeader } from '../components/PanelHeader.tsx'
import { RuleList } from '../components/RuleList.tsx'
import { StateBadge } from '../components/StateBadge.tsx'
import { WorkbenchTable } from '../components/WorkbenchTable.tsx'
import componentStyles from '../components/components.module.css'
import formStyles from '../components/forms.module.css'
import {
  measureKindLabel,
  sourceLabel,
} from '../properties/definitionLabels.ts'
import type { DefinitionKind } from '../properties/propertiesService.ts'
import { waitingReason } from '../service/usePendingReason.ts'
import type { DataColumn } from '../tables/tableModel.ts'
import { ScenarioComparison } from './ScenarioComparison.tsx'
import styles from './measures.module.css'

/** A row of the scenario preview: a rule, or the buildings without a measure. */
type PreviewRow = {
  id: string
  label: string
  matched: number | null
  counts: Record<MeasureKind, number>
}

const RULE_COMMANDS = [
  'scenarioRule.save',
  'scenarioRule.move',
  'scenarioRule.setEnabled',
  'scenarioRule.duplicate',
  'scenarioRule.remove',
]

/** Which measures a rule assigns, in a few words. */
function assignsLabel(
  measures: Record<MeasureKind, string | null>,
  names: Record<string, Measure>,
): string {
  const set = MEASURE_KINDS.filter((kind) => measures[kind] !== null)
  if (set.length === 0) return 'assigns nothing'
  return `assigns ${set.map((kind) => `${kindNoun(kind)}: ${names[measures[kind] ?? '']?.name ?? measures[kind]}`).join(', ')}`
}

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
      header: 'Category',
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
  ]
}

/**
 * Measures and scenarios (decision 0028; scenario rules from decision 0032,
 * stage 3): the scenarios, the chosen scenario's ordered rules and what they
 * would do, the project's measures, the synthetic measure library, and the
 * modeled comparison. Choosing a row shows it in Properties, where it is
 * edited; New starts a blank one there. Scenario modeling gives each
 * affected building an alternative version; adoption samples them when
 * results are aggregated.
 */
export function MeasuresPage() {
  const headingId = useId()
  const chooserId = useId()
  const { client, workbench, properties, showInspection, view } = useServices()
  const recordBlocked = useRecordBlocked()
  const state = useWorkbenchSnapshot((snapshot) => snapshot.state)
  const pending = useClientSnapshot((snapshot) => snapshot.pending)
  const previewScenarioId = useViewState(
    (view) => view.scenarios.previewScenarioId,
  )
  const stageStates = useStageStates()
  const modelingState = stageStates[STAGE_IDS.scenarioModeling] ?? 'future'
  const definitionsState =
    stageStates[STAGE_IDS.scenarioDefinitions] ?? 'future'
  const measures = Object.values(state.measures)
  const scenarios = Object.values(state.scenarios)
  const { selection } = state
  const names = new Set(measures.map((measure) => measure.name.toLowerCase()))
  const addBlocker = waitingReason(
    pending,
    'measure.addFromLibrary',
    'the measure is being added',
  )
  const ruleBlocker =
    RULE_COMMANDS.map((type) =>
      waitingReason(pending, type, 'the rules are being changed'),
    ).find(Boolean) ?? null

  // A chosen scenario rule shows its own scenario's rules.
  const ruleScenarioId =
    selection.entityType === 'scenarioRule'
      ? state.scenarioRules[selection.ids[0] ?? '']?.scenarioId
      : undefined
  const shown: Scenario | null =
    (ruleScenarioId ? state.scenarios[ruleScenarioId] : undefined) ??
    (previewScenarioId ? state.scenarios[previewScenarioId] : undefined) ??
    scenarios[0] ??
    null
  const rules = shown ? scenarioRules(state, shown) : []
  const preview = useMemo(
    () =>
      shown
        ? previewScenarioRules(state, {
            id: shown.id,
            rules: scenarioRules(state, shown),
            adoptionPercent: shown.adoptionPercent,
            adoptionSeed: shown.adoptionSeed,
          })
        : null,
    [state, shown],
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
  const showScenario = (scenarioId: string) =>
    view.execute({
      type: 'scenarios.setPreviewScenario',
      input: { scenarioId },
    })
  const create = (kind: DefinitionKind) => {
    properties.startCreate(kind)
    showInspection()
  }
  const send = (command: Parameters<typeof client.execute>[0]) =>
    void client.execute(command)
  const selectBuildings = (label: string, ids: string[], none: string) => {
    if (ids.length === 0) {
      recordBlocked(label, none)
      return
    }
    workbench.execute({
      type: 'selection.set',
      input: { entityType: 'building', ids },
    })
    showInspection()
  }

  // The run that holds scenario versions not yet published, if one is open.
  const openGroup = state.runGroupIds
    .map((id) => state.runGroups[id])
    .find(
      (group) =>
        group?.kind === 'stage' &&
        group.stageId === STAGE_IDS.scenarioModeling &&
        group.status === 'open',
    )
  const running = openGroup?.attemptIds.some((id) => {
    const task = state.tasks[id]
    return task ? isActiveStatus(task.status) : false
  })
  const held = openGroup ? Object.keys(openGroup.held).length : 0
  const nextStageId =
    definitionsState === 'executed'
      ? STAGE_IDS.scenarioModeling
      : STAGE_IDS.scenarioDefinitions
  const nextStageName =
    state.workflow.stages[nextStageId]?.name ??
    (nextStageId === STAGE_IDS.scenarioModeling
      ? 'Scenario modeling'
      : 'Scenario definitions')
  const runBlocker =
    waitingReason(
      pending,
      'workflow.runStage',
      'the run is being queued',
      (input) => (input as { stageId?: unknown }).stageId === nextStageId,
    ) ?? stageSubmitBlocker(state, nextStageId)

  const effectOf = (ruleId: string) => {
    const own = preview?.rules.find((each) => each.ruleId === ruleId)
    if (!own) return ''
    if (own.matched === 0) return 'Matches no building'
    const most = Math.max(...MEASURE_KINDS.map((kind) => own.takes[kind]))
    return `Matches ${own.matched}, takes ${most === 0 ? 'no measure' : `measures of ${most}`}`
  }

  const previewRows: PreviewRow[] = preview
    ? [
        ...rules.map((rule, index) => {
          const own = preview.rules.find((each) => each.ruleId === rule.id)
          return {
            id: rule.id,
            label: `${index + 1}. ${rule.name}${rule.enabled ? '' : ' (off)'}`,
            matched: own?.matched ?? 0,
            counts: own?.takes ?? {
              envelope: 0,
              heating: 0,
              lighting: 0,
              pv: 0,
            },
          }
        }),
        {
          id: 'none',
          label: 'No measure',
          matched: preview.unaffectedIds.length,
          counts: { envelope: 0, heating: 0, lighting: 0, pv: 0 },
        },
      ]
    : []
  const previewColumns: DataColumn<PreviewRow>[] = [
    {
      id: 'rule',
      header: 'Rule',
      value: (row) => row.label,
      rowHeader: true,
      wrap: true,
    },
    {
      id: 'matched',
      header: 'Matches',
      value: (row) => row.matched,
      type: 'number',
      empty: '',
    },
    ...MEASURE_KINDS.map((kind): DataColumn<PreviewRow> => ({
      id: kind,
      header: KIND_LABELS[kind],
      value: (row) => (row.id === 'none' ? null : row.counts[kind]),
      type: 'number',
      empty: '',
    })),
  ]

  const projectColumns: DataColumn<Measure>[] = [
    ...measureColumns<Measure>(),
    {
      id: 'usedBy',
      header: 'Used by rules',
      value: (measure) =>
        Object.values(state.scenarioRules).filter((rule) =>
          MEASURE_KINDS.some((kind) => rule.measures[kind] === measure.id),
        ).length,
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
      id: 'rules',
      header: 'Rules',
      value: (scenario) => scenario.ruleIds.length,
      type: 'number',
    },
    {
      id: 'measures',
      header: 'Measures',
      wrap: true,
      value: (scenario) =>
        scenarioMeasureIds(state, scenario)
          .map((id) => state.measures[id]?.name ?? id)
          .join(', '),
      empty: 'None',
    },
    {
      id: 'adoption',
      header: 'Adoption',
      value: (scenario) => scenario.adoptionPercent,
      type: 'number',
      unit: '%',
    },
    {
      id: 'seed',
      header: 'Seed',
      value: (scenario) => scenario.adoptionSeed,
      type: 'number',
      decimals: 0,
    },
    {
      id: 'comparison',
      header: 'Comparison',
      value: (scenario) => (scenario.included ? 'Included' : 'Left out'),
      type: 'enum',
    },
  ]

  const selectedRule = selectedOf('scenarioRule')
  const enabledRules = rules.filter((rule) => rule.enabled).length
  const adopting = preview?.adoptedIds.length ?? 0

  return (
    <section
      className={`${componentStyles.page} ${styles.page}`}
      aria-labelledby={headingId}
    >
      <PanelHeader
        title="Measures and scenarios"
        headingId={headingId}
        meta={<CapabilityBadge id="creator.measure" />}
        actions={
          <span className={styles.stage}>
            Scenario modeling <StateBadge state={modelingState} />
          </span>
        }
        description="A scenario's rules choose buildings and give each at most one measure per category, tried top first. Scenario modeling gives each affected building an alternative version; adoption samples those buildings with a fixed seed when results are aggregated, so changing it needs no new run. Choose a row to edit it in Properties."
      />

      <section className={styles.section} aria-label="Scenarios">
        <h3 className={styles.sectionTitle}>Scenarios</h3>
        <WorkbenchTable
          id="creator.scenarios"
          aria-label="Scenarios"
          columns={scenarioColumns}
          rows={scenarios}
          rowKey={(scenario) => scenario.id}
          className={styles.table}
          emptyText="No scenarios yet. A scenario's rules give buildings measures; adoption decides how many adopt them."
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
            onSelect: (id) => {
              showScenario(id)
              choose('scenario')(id)
            },
          }}
        />
      </section>

      <section className={styles.section} aria-label="Scenario rules">
        <h3 className={styles.sectionTitle}>Scenario rules</h3>
        {!shown ? (
          <InlineAlert tone="info" title="No scenario yet" live="off">
            Create a scenario first; its rules appear here.
          </InlineAlert>
        ) : (
          <>
            <div className={styles.chooser}>
              <div className={formStyles.field}>
                <label className={formStyles.label} htmlFor={chooserId}>
                  Rules of scenario
                </label>
                <select
                  id={chooserId}
                  className={formStyles.input}
                  value={shown.id}
                  onChange={(event) => {
                    if (ruleScenarioId) {
                      workbench.execute({ type: 'selection.clear', input: {} })
                    }
                    showScenario(event.target.value)
                  }}
                >
                  {scenarios.map((scenario) => (
                    <option key={scenario.id} value={scenario.id}>
                      {scenario.name}
                    </option>
                  ))}
                </select>
              </div>
              <span className={componentStyles.muted}>
                {shown.adoptionPercent}% adoption, seed {shown.adoptionSeed}
                {shown.included ? '' : '; left out of the comparison'}
              </span>
            </div>
            {running ? (
              <InlineAlert tone="info" title="Scenario modeling is running">
                Published results stay as they are until every scenario in the
                set is modeled. The preview below shows what the current rules
                would do.
              </InlineAlert>
            ) : held > 0 ? (
              <InlineAlert tone="warning" title="Scenario results are held">
                {held} scenarios have held versions from a run that has not
                published; published results stay as they are. Retry or rerun it
                from Jobs.
              </InlineAlert>
            ) : modelingState === 'stale' &&
              preview?.changes !== null &&
              (preview?.changes ?? 0) > 0 ? (
              <InlineAlert
                tone="warning"
                title="The preview differs from the published results"
              >
                With the current rules, {preview?.changes} buildings would take
                other measures than the published versions. Run Scenario
                definitions and Scenario modeling to publish them.
              </InlineAlert>
            ) : null}
            {preview && preview.warnings.length > 0 && rules.length > 0 ? (
              <InlineAlert tone="warning" title="Rule warnings">
                <ul className={styles.warnings}>
                  {preview.warnings.map((warning, index) => (
                    <li key={`${warning.code}-${warning.ruleId ?? index}`}>
                      {warning.message}
                    </li>
                  ))}
                </ul>
              </InlineAlert>
            ) : null}
            <RuleList
              aria-label="Scenario rules"
              rules={rules.map((rule) => ({
                id: rule.id,
                name: rule.name,
                enabled: rule.enabled,
                summary: `${describeConditions(CONDITION_FIELDS, rule.logic, rule.conditions)}; ${assignsLabel(rule.measures, state.measures)}`,
                effect: effectOf(rule.id),
              }))}
              selectedId={selectedRule}
              onSelect={choose('scenarioRule')}
              onToggle={(ruleId, enabled) =>
                send({
                  type: 'scenarioRule.setEnabled',
                  input: { ruleId, enabled },
                })
              }
              onMove={(ruleId, position) =>
                send({ type: 'scenarioRule.move', input: { ruleId, position } })
              }
              onAdd={() => create(`scenarioRule:${shown.id}`)}
              onDuplicate={(ruleId) =>
                send({ type: 'scenarioRule.duplicate', input: { ruleId } })
              }
              onRemove={(ruleId) =>
                send({ type: 'scenarioRule.remove', input: { ruleId } })
              }
              disabledReason={ruleBlocker}
              onBlocked={(item, reason) =>
                recordBlocked(item.ariaLabel ?? item.label, reason)
              }
              empty={
                <InlineAlert tone="warning" title="No rules" live="off">
                  {`"${shown.name}" has no rules, so it changes no building and its results equal the baseline. Add a rule that chooses buildings and gives them measures.`}
                </InlineAlert>
              }
            />
            {rules.length > 0 && enabledRules === 0 ? (
              <InlineAlert tone="warning" title="Every rule is off" live="off">
                No building takes a measure until a rule is switched on.
              </InlineAlert>
            ) : null}

            <section className={styles.section} aria-label="Scenario preview">
              <h3 className={styles.sectionTitle}>Scenario preview</h3>
              <p role="status">
                {!preview || preview.buildings === 0
                  ? 'No buildings yet. Run the workflow from Location setup first.'
                  : `With the current rules, ${preview.affectedIds.length} of ${preview.buildings} ${state.results.baseline ? 'modeled ' : ''}buildings take at least one measure (${MEASURE_KINDS.map((kind) => `${kindNoun(kind)} ${preview.byKind[kind]}`).join(', ')}); ${adopting} adopt at ${shown.adoptionPercent}%, seed ${shown.adoptionSeed}. ${
                      preview.estimate
                        ? `Estimated ${preview.estimate.reductionPercent}% lower annual demand than the baseline, ${preview.estimate.fullReductionPercent}% if every affected building adopted (synthetic).`
                        : 'No baseline yet: estimates need baseline results. Run "Baseline model setup".'
                    }`}
              </p>
              {preview && preview.buildings > 0 ? (
                <WorkbenchTable
                  id="creator.scenarioPreview"
                  aria-label="Scenario preview"
                  columns={previewColumns}
                  rows={previewRows}
                  rowKey={(row) => row.id}
                  selection={{
                    selectedKey: selectedRule,
                    onSelect: (id) => {
                      if (state.scenarioRules[id]) {
                        choose('scenarioRule')(id)
                        return
                      }
                      selectBuildings(
                        'Select buildings without a measure',
                        preview.unaffectedIds,
                        'Every building takes a measure.',
                      )
                    },
                  }}
                  exportable={false}
                />
              ) : null}
              {preview && preview.buildings > 0 ? (
                <p className={componentStyles.muted}>
                  Choose a rule to edit it in Properties. Choose No measure to
                  select the buildings no rule gives a measure, on the Map and
                  Table.
                </p>
              ) : null}
              <div className={styles.formActions}>
                <ActionButton
                  label={`Select the ${adopting} buildings that adopt at ${shown.adoptionPercent}%`}
                  disabledReason={
                    adopting === 0
                      ? preview && preview.affectedIds.length > 0
                        ? 'No affected building adopts at this adoption and seed.'
                        : 'No building takes a measure.'
                      : null
                  }
                  onPress={() =>
                    selectBuildings(
                      'Select adopting buildings',
                      preview?.adoptedIds ?? [],
                      'No building adopts.',
                    )
                  }
                >
                  Select adopting buildings
                </ActionButton>
                <ActionButton
                  label={`Run ${nextStageName}`}
                  variant="primary"
                  disabledReason={runBlocker}
                  onPress={() =>
                    send({
                      type: 'workflow.runStage',
                      input: { stageId: nextStageId },
                    })
                  }
                >
                  Run {nextStageName}
                </ActionButton>
                <span className={componentStyles.muted}>
                  Scenario modeling runs as a job, one item per scenario in the
                  comparison set; results change only when every scenario has
                  been modeled.
                </span>
              </div>
            </section>
          </>
        )}
      </section>

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
          selection={{
            selectedKey: selectedOf('libraryMeasure'),
            onSelect: choose('libraryMeasure'),
          }}
          exportable={false}
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
