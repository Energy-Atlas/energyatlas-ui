import {
  ARCHETYPE_LIBRARY,
  SCHEDULE_LIBRARY,
} from '../../domain/archetypes/library.ts'
import { PART_LABELS } from '../../domain/archetypes/parts.ts'
import { MEASURE_LIBRARY } from '../../domain/scenarios/library.ts'
import {
  PART_KINDS,
  type SelectableEntity,
  type WorkbenchState,
} from '../../domain/types.ts'
import { STAGE_IDS } from '../../domain/workflow.ts'
import { describeZoning } from '../../domain/zoning/zoning.ts'
import { useStageStates, useWorkbenchSnapshot } from '../WorkbenchContext.tsx'
import { PropertyList, type Property } from '../components/PropertyList.tsx'
import { StateBadge } from '../components/StateBadge.tsx'
import { formatDateTime } from '../format.ts'
import styles from './properties.module.css'

const KIND_LABELS: Record<SelectableEntity, string> = {
  building: 'Building',
  gridElement: 'Grid element',
  archetype: 'Archetype',
  schedule: 'Schedule',
  measure: 'Measure',
  scenario: 'Scenario',
  asset: 'Asset',
  stage: 'Stage',
  libraryArchetype: 'Library archetype',
  librarySchedule: 'Library schedule',
  libraryMeasure: 'Library measure',
  archetypePart: 'Archetype part',
  assignmentRule: 'Assignment rule',
  scenarioRule: 'Scenario rule',
  floor: 'Floor',
  zone: 'Zone',
}

const yesNo = (value: boolean) => (value ? 'Yes' : 'No')

/** The name and facts of a definition as handed over, or null if missing. */
function describe(
  state: WorkbenchState,
  entityType: SelectableEntity,
  id: string,
): { name: string; facts: Property[] } | null {
  switch (entityType) {
    case 'archetype': {
      const archetype = state.archetypes[id]
      if (!archetype) return null
      return {
        name: archetype.name,
        facts: PART_KINDS.map((kind) => {
          const partId = archetype.parts[kind]
          return {
            label: PART_LABELS[kind],
            value: partId ? (state.parts[partId]?.name ?? partId) : 'None',
          }
        }),
      }
    }
    case 'archetypePart': {
      const part = state.parts[id]
      return part
        ? {
            name: part.name,
            facts: [{ label: 'Kind', value: PART_LABELS[part.kind] }],
          }
        : null
    }
    case 'schedule': {
      const schedule = state.schedules[id]
      return schedule
        ? {
            name: schedule.name,
            facts: [
              {
                label: 'Day types',
                value: schedule.days.map((day) => day.name).join(', '),
              },
            ],
          }
        : null
    }
    case 'measure': {
      const measure = state.measures[id]
      return measure
        ? {
            name: measure.name,
            facts: [
              { label: 'Category', value: measure.kind },
              { label: 'Savings', value: `${measure.savingsPercent}%` },
            ],
          }
        : null
    }
    case 'scenario': {
      const scenario = state.scenarios[id]
      return scenario
        ? {
            name: scenario.name,
            facts: [
              { label: 'Adoption', value: `${scenario.adoptionPercent}%` },
              { label: 'Seed', value: String(scenario.adoptionSeed) },
              { label: 'Rules', value: String(scenario.ruleIds.length) },
            ],
          }
        : null
    }
    case 'assignmentRule': {
      const rule = state.rules[id]
      return rule
        ? {
            name: rule.name,
            facts: [
              {
                label: 'Position',
                value: String(state.ruleIds.indexOf(id) + 1),
              },
              { label: 'On', value: yesNo(rule.enabled) },
            ],
          }
        : null
    }
    case 'scenarioRule': {
      const rule = state.scenarioRules[id]
      return rule
        ? {
            name: rule.name,
            facts: [
              {
                label: 'Scenario',
                value:
                  state.scenarios[rule.scenarioId]?.name ?? rule.scenarioId,
              },
              { label: 'On', value: yesNo(rule.enabled) },
            ],
          }
        : null
    }
    case 'libraryArchetype': {
      const entry = ARCHETYPE_LIBRARY.find((item) => item.id === id)
      return entry ? { name: entry.name, facts: [] } : null
    }
    case 'librarySchedule': {
      const entry = SCHEDULE_LIBRARY.find((item) => item.id === id)
      return entry ? { name: entry.name, facts: [] } : null
    }
    case 'libraryMeasure': {
      const entry = MEASURE_LIBRARY.find((item) => item.libraryId === id)
      return entry ? { name: entry.name, facts: [] } : null
    }
    default:
      return null
  }
}

/**
 * A definition or stage as handed over (decision 0032, stage 5): its kind,
 * name, a note, and a few facts, with nothing to edit. Shown in the gallery.
 */
export function DefinitionCard({
  eyebrow,
  title,
  note,
  facts,
}: {
  eyebrow: string
  title: string
  note?: string
  facts: Property[]
}) {
  return (
    <section className={styles.definition} aria-label={`${eyebrow} ${title}`}>
      <header className={styles.header}>
        <p className={styles.eyebrow}>{eyebrow}</p>
        <h3 className={styles.title}>{title}</h3>
        {note ? <p className={styles.provenance}>{note}</p> : null}
      </header>
      {facts.length > 0 ? <PropertyList items={facts} /> : null}
    </section>
  )
}

/**
 * A definition or stage on the viewer page (decision 0032, stage 5): what it
 * is, as handed over. The viewer edits nothing, so there are no fields to
 * change and no Save; the modeller edits definitions.
 */
export function ReadOnlyDefinition({
  entityType,
  id,
}: {
  entityType: SelectableEntity
  id: string
}) {
  const state = useWorkbenchSnapshot((snapshot) => snapshot.state)
  const stageStates = useStageStates()
  if (entityType === 'stage') {
    const stage = state.workflow.stages[id]
    if (!stage) return null
    return (
      <DefinitionCard
        eyebrow="Stage"
        title={stage.name}
        facts={[
          {
            label: 'State at handover',
            value: <StateBadge state={stageStates[id] ?? 'future'} />,
          },
          {
            label: 'Last run',
            value: stage.lastRun
              ? `${stage.lastRun.outcome === 'succeeded' ? 'Succeeded' : 'Failed'} ${formatDateTime(stage.lastRun.finishedAt)}`
              : 'Never ran',
          },
          // The zoning setting is shown, never offered (decision 0032, stage 6).
          ...(id === STAGE_IDS.preprocessing
            ? [
                {
                  label: 'Zoning',
                  value: state.zoning.published
                    ? describeZoning(state.zoning.published)
                    : 'Not zoned by a setting yet',
                },
              ]
            : []),
        ]}
      />
    )
  }
  const described = describe(state, entityType, id)
  if (!described) return null
  return (
    <DefinitionCard
      eyebrow={KIND_LABELS[entityType]}
      title={described.name}
      note="As handed over. Definitions are edited in the modeller."
      facts={described.facts}
    />
  )
}
