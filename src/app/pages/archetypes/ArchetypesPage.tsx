import { ListRestart, Plus } from 'lucide-react'
import { useId, useMemo } from 'react'
import {
  generatesDefaultRules,
  missingDefaults,
  orderedRules,
  previewAssignment,
  scheduleStats,
} from '../../../domain/archetypes/assignment.ts'
import {
  ARCHETYPE_LIBRARY,
  PART_LIBRARY,
  SCHEDULE_LIBRARY,
} from '../../../domain/archetypes/library.ts'
import {
  PART_LABELS,
  archetypeIntensity,
  partSummary,
} from '../../../domain/archetypes/parts.ts'
import { stageSubmitBlocker } from '../../../domain/commands.ts'
import { describeConditions } from '../../../domain/rules/conditions.ts'
import { isActiveStatus } from '../../../domain/jobs/runGroups.ts'
import type {
  Archetype,
  ArchetypePart,
  PartKind,
  Schedule,
  SelectableEntity,
} from '../../../domain/types.ts'
import { PART_KINDS } from '../../../domain/types.ts'
import { STAGE_IDS } from '../../../domain/workflow.ts'
import {
  useClientSnapshot,
  useServices,
  useStageStates,
  useViewState,
  useWorkbenchSnapshot,
} from '../../WorkbenchContext.tsx'
import {
  ActionButton,
  useRecordBlocked,
} from '../../components/ActionButton.tsx'
import { CapabilityBadge } from '../../components/CapabilityBadge.tsx'
import { InlineAlert } from '../../components/InlineAlert.tsx'
import { MenuButton } from '../../components/MenuButton.tsx'
import { PanelHeader } from '../../components/PanelHeader.tsx'
import { RuleList } from '../../components/RuleList.tsx'
import { SegmentedFilter } from '../../components/SegmentedFilter.tsx'
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

/** A row of the assignment preview: a rule, manual parts, or what is left. */
type PreviewRow = {
  id: string
  label: string
  matched: number | null
  counts: Record<PartKind, number>
}

type PreviewPart = PartKind | 'all'

const RULE_COMMANDS = [
  'rule.save',
  'rule.move',
  'rule.setEnabled',
  'rule.duplicate',
  'rule.remove',
  'rule.generateDefaults',
]

/** Which parts a rule sets, in a few words. */
function setsLabel(parts: Record<PartKind, string | null>): string {
  const set = PART_KINDS.filter((kind) => parts[kind] !== null)
  if (set.length === PART_KINDS.length) return 'sets all four parts'
  if (set.length === 0) return 'sets nothing'
  return `sets ${set.map((kind) => PART_LABELS[kind].toLowerCase()).join(', ')}`
}

/**
 * Archetypes (decision 0032; earlier slice 5 and decision 0028): assignment
 * rules that give each building RC's four parts, the preview of what they
 * would assign, the archetypes the default rules come from, the parts, the
 * synthetic library, and the schedules. Choosing a row shows it in
 * Properties, where it is edited; assignment runs as a job.
 */
export function ArchetypesPage() {
  const headingId = useId()
  const { client, workbench, properties, showInspection, view } = useServices()
  const recordBlocked = useRecordBlocked()
  const state = useWorkbenchSnapshot((snapshot) => snapshot.state)
  const pending = useClientSnapshot((snapshot) => snapshot.pending)
  const previewPart = useViewState((view) => view.archetypes.previewPart)
  const stageStates = useStageStates()
  const stageState = stageStates[STAGE_IDS.archetypes] ?? 'future'
  const archetypes = Object.values(state.archetypes)
  const parts = Object.values(state.parts)
  const schedules = Object.values(state.schedules)
  const preview = useMemo(() => previewAssignment(state), [state])
  const rules = orderedRules(state)
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
  const ruleBlocker =
    RULE_COMMANDS.map((type) =>
      waitingReason(pending, type, 'the rules are being changed'),
    ).find(Boolean) ?? null

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
  const send = (command: Parameters<typeof client.execute>[0]) =>
    void client.execute(command)

  // The run that holds assignments not yet published, if one is open.
  const openGroup = state.runGroupIds
    .map((id) => state.runGroups[id])
    .find(
      (group) =>
        group?.kind === 'stage' &&
        group.stageId === STAGE_IDS.archetypes &&
        group.status === 'open',
    )
  const running = openGroup?.attemptIds.some((id) => {
    const task = state.tasks[id]
    return task ? isActiveStatus(task.status) : false
  })
  const held = openGroup ? Object.keys(openGroup.held).length : 0
  const willGenerate = generatesDefaultRules(state)
  const addedDefaults = missingDefaults(state)

  const partName = (id: string | null) =>
    id ? (state.parts[id]?.name ?? id) : null
  const kinds: PartKind[] =
    previewPart === 'all' ? [...PART_KINDS] : [previewPart]
  const effectOf = (ruleId: string) => {
    const own = preview.rules.find((each) => each.ruleId === ruleId)
    if (!own) return ''
    if (own.matched === 0) return 'Matches no building'
    const takes = kinds
      .filter((kind) => state.rules[ruleId]?.parts[kind] !== null)
      .map((kind) => own.takes[kind])
    const most = takes.length > 0 ? Math.max(...takes) : 0
    return `Matches ${own.matched}, takes ${most === 0 ? 'no part' : `parts of ${most}`}`
  }

  const previewRows: PreviewRow[] = [
    ...rules.map((rule, index) => {
      const own = preview.rules.find((each) => each.ruleId === rule.id)
      return {
        id: rule.id,
        label: `${index + 1}. ${rule.name}${rule.enabled ? '' : ' (off)'}`,
        matched: own?.matched ?? 0,
        counts: own?.takes ?? {
          construction: 0,
          systems: 0,
          spaceLoads: 0,
          externalLoads: 0,
        },
      }
    }),
    {
      id: 'manual',
      label: 'Manual parts',
      matched: null,
      counts: preview.manual,
    },
    {
      id: 'unassigned',
      label: 'Unassigned',
      matched: null,
      counts: preview.unassigned,
    },
  ]
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
    ...kinds.map((kind): DataColumn<PreviewRow> => ({
      id: kind,
      header: PART_LABELS[kind],
      value: (row) => row.counts[kind],
      type: 'number',
    })),
  ]

  const intensityOf = (archetype: Archetype, library: boolean) =>
    archetypeIntensity(
      archetype,
      library
        ? {
            ...Object.fromEntries(PART_LIBRARY.map((part) => [part.id, part])),
            ...state.parts,
          }
        : state.parts,
      library
        ? {
            ...Object.fromEntries(
              SCHEDULE_LIBRARY.map((schedule) => [schedule.id, schedule]),
            ),
            ...state.schedules,
          }
        : state.schedules,
    )?.total ?? null

  const archetypeColumns: DataColumn<Archetype>[] = [
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
    ...PART_KINDS.map((kind): DataColumn<Archetype> => ({
      id: kind,
      header: PART_LABELS[kind],
      value: (archetype) =>
        partName(archetype.parts[kind]) ??
        (archetype.parts[kind]
          ? (PART_LIBRARY.find((part) => part.id === archetype.parts[kind])
              ?.name ?? null)
          : null),
      type: 'enum',
      empty: 'None',
    })),
    {
      id: 'eui',
      header: 'Energy use intensity',
      value: (archetype) =>
        intensityOf(archetype, !state.archetypes[archetype.id]),
      type: 'number',
      unit: 'kWh/m²',
      decimals: 0,
      empty: 'Needs four parts',
    },
  ]

  const projectArchetypeColumns: DataColumn<Archetype>[] = [
    ...archetypeColumns,
    {
      id: 'source',
      header: 'Source',
      value: (archetype) => sourceLabel(archetype.source),
      type: 'enum',
    },
  ]

  const libraryColumns: DataColumn<Archetype>[] = [
    ...archetypeColumns,
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

  const partColumns: DataColumn<ArchetypePart>[] = [
    {
      id: 'name',
      header: 'Name',
      value: (part) => part.name,
      rowHeader: true,
    },
    {
      id: 'kind',
      header: 'Kind',
      value: (part) => PART_LABELS[part.kind],
      type: 'enum',
    },
    {
      id: 'values',
      header: 'Values',
      value: (part) => partSummary(part, state.schedules),
      wrap: true,
    },
    {
      id: 'rules',
      header: 'Used by rules',
      value: (part) =>
        rules.filter((rule) => rule.parts[part.kind] === part.id).length,
      type: 'number',
    },
    {
      id: 'source',
      header: 'Source',
      value: (part) => sourceLabel(part.source),
      type: 'enum',
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
      header: 'Used by space loads',
      value: (schedule) =>
        parts.filter(
          (part) =>
            part.kind === 'spaceLoads' && part.scheduleId === schedule.id,
        ).length,
      type: 'number',
    },
    {
      id: 'source',
      header: 'Source',
      value: (schedule) => sourceLabel(schedule.source),
      type: 'enum',
    },
  ]

  // Library schedules come into the project with the space loads that use
  // them, so the library lists which those are.
  const scheduleLibraryColumns: DataColumn<Schedule>[] = [
    ...scheduleColumns.slice(0, 4),
    {
      id: 'usedByLibrary',
      header: 'Used by library space loads',
      value: (schedule) =>
        PART_LIBRARY.filter(
          (part) =>
            part.kind === 'spaceLoads' && part.scheduleId === schedule.id,
        )
          .map((part) => part.name)
          .join(', '),
      wrap: true,
    },
    {
      id: 'inProject',
      header: 'In project',
      value: (schedule) => (state.schedules[schedule.id] ? 'Yes' : 'No'),
      type: 'enum',
    },
  ]

  const selectedRule = selectedOf('assignmentRule')
  const generateBlocker =
    archetypes.length === 0
      ? 'There are no archetypes to generate rules from. Add archetypes from the library first.'
      : ruleBlocker

  return (
    <section
      className={`${componentStyles.page} ${styles.page}`}
      aria-labelledby={headingId}
    >
      <PanelHeader
        className={styles.header}
        title="Archetypes and assignment rules"
        headingId={headingId}
        meta={<CapabilityBadge id="archetypes.library" />}
        actions={
          <span className={styles.stage}>
            Archetype modeling <StateBadge state={stageState} />
          </span>
        }
        description="Rules give each building RC's four archetype parts, tried top first; each part takes the first enabled rule that matches and sets it, and a manual part set in the Table wins. Choose a row to edit it in Properties."
      />

      <section className={styles.section} aria-label="Assignment rules">
        <h3 className={styles.sectionTitle}>Assignment rules</h3>
        {running ? (
          <InlineAlert tone="info" title="Archetype modeling is running">
            Buildings keep their published parts until every building is
            assigned. The preview below shows what the current rules would
            assign.
          </InlineAlert>
        ) : held > 0 ? (
          <InlineAlert tone="warning" title="Assignments are held">
            {held} buildings have held assignments from a run that has not
            published; buildings keep their published parts. The preview shows
            the current rules, which may differ from that run. Retry or rerun it
            from Jobs.
          </InlineAlert>
        ) : stageState === 'stale' && preview.changes > 0 ? (
          <InlineAlert
            tone="warning"
            title="The preview differs from the published parts"
          >
            With the current rules and parts, {preview.changes} buildings would
            change. Run assignment to publish them.
          </InlineAlert>
        ) : null}
        {preview.warnings.length > 0 && rules.length > 0 ? (
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
          aria-label="Assignment rules"
          rules={rules.map((rule) => ({
            id: rule.id,
            name: rule.name,
            enabled: rule.enabled,
            summary: `${describeConditions(rule.logic, rule.conditions)}; ${setsLabel(rule.parts)}`,
            effect: effectOf(rule.id),
          }))}
          selectedId={selectedRule}
          onSelect={choose('assignmentRule')}
          onToggle={(ruleId, enabled) =>
            send({ type: 'rule.setEnabled', input: { ruleId, enabled } })
          }
          onMove={(ruleId, position) =>
            send({ type: 'rule.move', input: { ruleId, position } })
          }
          onAdd={() => create('assignmentRule')}
          onDuplicate={(ruleId) =>
            send({ type: 'rule.duplicate', input: { ruleId } })
          }
          onRemove={(ruleId) =>
            send({ type: 'rule.remove', input: { ruleId } })
          }
          disabledReason={ruleBlocker}
          extraItems={[
            {
              id: 'defaults',
              label: 'Generate default rules',
              icon: ListRestart,
              group: 'defaults',
              disabledReason: generateBlocker,
              onPress: () => send({ type: 'rule.generateDefaults', input: {} }),
            },
          ]}
          onBlocked={(item, reason) =>
            recordBlocked(item.ariaLabel ?? item.label, reason)
          }
          empty={
            <InlineAlert
              tone={willGenerate ? 'info' : 'warning'}
              title="No assignment rules"
              live="off"
            >
              {willGenerate
                ? `The first Archetype modeling run generates default rules: one per archetype${addedDefaults.length > 0 ? ` (it also adds ${addedDefaults.length} default library archetypes)` : ''} and a fallback for any building. You can also generate them now or write a rule.`
                : 'Archetype modeling cannot run without a rule. Generate the default rules from the archetypes, or write a rule.'}
            </InlineAlert>
          }
        />

        <section className={styles.section} aria-label="Assignment preview">
          <h3 className={styles.sectionTitle}>Assignment preview</h3>
          <SegmentedFilter<PreviewPart>
            aria-label="Preview part"
            segments={[
              { id: 'all', label: 'All parts' },
              ...PART_KINDS.map((kind) => ({
                id: kind,
                label: PART_LABELS[kind],
              })),
            ]}
            value={previewPart}
            onChange={(part) =>
              view.execute({
                type: 'archetypes.setPreviewPart',
                input: { part },
              })
            }
          />
          <p role="status">
            {preview.buildings === 0
              ? 'No buildings yet. Run the workflow from Location setup first.'
              : `With the current rules, ${preview.complete} of ${preview.buildings} buildings get all four parts; ${PART_KINDS.map((kind) => `${preview.unassigned[kind]} lack ${PART_LABELS[kind].toLowerCase()}`).join(', ')}. ${preview.changes} buildings would change from the published parts.`}
          </p>
          {preview.buildings > 0 ? (
            <WorkbenchTable
              id="archetypes.preview"
              aria-label="Assignment preview"
              columns={previewColumns}
              rows={previewRows}
              rowKey={(row) => row.id}
              selection={{
                selectedKey: selectedRule,
                onSelect: (id) => {
                  if (state.rules[id]) choose('assignmentRule')(id)
                },
              }}
              exportable={false}
            />
          ) : null}
          <div className={styles.formActions}>
            <ActionButton
              label="Run Archetype modeling to assign buildings"
              variant="primary"
              disabledReason={runBlocker}
              onPress={() =>
                send({
                  type: 'workflow.runStage',
                  input: { stageId: STAGE_IDS.archetypes },
                })
              }
            >
              Run assignment
            </ActionButton>
            <span className={componentStyles.muted}>
              Assignment runs as a job; buildings change only when every
              building has been assigned.
            </span>
          </div>
        </section>
      </section>

      <section className={styles.section} aria-label="Project archetypes">
        <h3 className={styles.sectionTitle}>Project archetypes</h3>
        <WorkbenchTable
          id="archetypes.definitions"
          aria-label="Project archetypes"
          columns={projectArchetypeColumns}
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

      <section className={styles.section} aria-label="Archetype parts">
        <h3 className={styles.sectionTitle}>Archetype parts</h3>
        <WorkbenchTable
          id="archetypes.parts"
          aria-label="Archetype parts"
          columns={partColumns}
          rows={parts}
          rowKey={(part) => part.id}
          className={styles.table}
          emptyText="No parts yet. Library archetypes bring their four parts; you can also create one."
          search={{
            label: 'Search archetype parts',
            placeholder: 'Search parts',
          }}
          barStart={
            <MenuButton
              label={
                <>
                  <Plus size={14} aria-hidden="true" /> New part
                </>
              }
              aria-label="New part"
              showChevron
              groups={[
                {
                  id: 'kinds',
                  items: PART_KINDS.map((kind) => ({
                    id: kind,
                    label: PART_LABELS[kind],
                  })),
                },
              ]}
              onAction={(kind) => create(`part:${kind as PartKind}`)}
            />
          }
          selection={{
            selectedKey: selectedOf('archetypePart'),
            onSelect: choose('archetypePart'),
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
          selection={{
            selectedKey: selectedOf('libraryArchetype'),
            onSelect: choose('libraryArchetype'),
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
          emptyText="No schedules yet. Library space loads bring their schedules; you can also create one."
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

      <section className={styles.section} aria-label="Schedule library">
        <h3 className={styles.sectionTitle}>Schedule library</h3>
        <WorkbenchTable
          id="archetypes.scheduleLibrary"
          aria-label="Schedule library"
          columns={scheduleLibraryColumns}
          rows={[...SCHEDULE_LIBRARY]}
          rowKey={(schedule) => schedule.id}
          className={styles.table}
          search={{
            label: 'Search the schedule library',
            placeholder: 'Search the library',
          }}
          selection={{
            selectedKey: selectedOf('librarySchedule'),
            onSelect: choose('librarySchedule'),
          }}
          exportable={false}
        />
      </section>
    </section>
  )
}
