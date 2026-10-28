import { DEFAULT_ADOPTION_SEED } from '../domain/scenarios/rules.ts'
import type { BuildingUse, MeasureKind } from '../domain/types.ts'
import { MEASURE_KINDS } from '../domain/types.ts'
import { STAGE_IDS } from '../domain/workflow.ts'

// Saved projects from before scenario rules (decision 0032, stage 3) kept a
// list of measures per scenario and a building use on each measure
// ("applies to"). This turns such a save into rules before the schema checks
// it, so each scenario still chooses the same buildings for the same
// measures:
//
// - each distinct "applies to" among a scenario's measures becomes one rule:
//   "use equals" that use, or no conditions for all buildings. A scenario has
//   at most one measure of each kind, so the rules set disjoint categories
//   and their order does not change what a building takes;
// - measures lose "applies to"; scenarios get the default adoption seed;
// - open Scenario modeling runs are invalidated (their held results predate
//   versions), and where Scenario modeling had run, its results are marked
//   outdated with an issue: adoption used to scale savings, and is now
//   sampled per building when results are aggregated.

type Raw = Record<string, unknown>

const isObject = (value: unknown): value is Raw =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/** The issue a migrated project shows about its outdated scenario results. */
export const SCENARIO_MIGRATION_ISSUE_ID = 'issue:migrated-scenario-rules'

const USE_NAMES: Record<BuildingUse, string> = {
  residential: 'Residential buildings',
  office: 'Office buildings',
  retail: 'Retail buildings',
  school: 'School buildings',
  mixed: 'Mixed-use buildings',
}

/** The id the migrated rule of a scenario for one "applies to" has. */
export function migratedScenarioRuleId(
  scenarioId: string,
  appliesTo: string,
): string {
  return `scenarioRule:migrated:${scenarioId}:${appliesTo}`
}

function isUse(value: unknown): value is BuildingUse {
  return typeof value === 'string' && value in USE_NAMES
}

function isKind(value: unknown): value is MeasureKind {
  return (
    typeof value === 'string' &&
    (MEASURE_KINDS as readonly string[]).includes(value)
  )
}

/**
 * Migrates a save from before scenario rules; other values pass through
 * unchanged for the schema to check.
 */
export function migrateScenarioRules(value: unknown): unknown {
  if (!isObject(value)) return value
  const scenarios = isObject(value.scenarios) ? value.scenarios : {}
  const measures = isObject(value.measures) ? value.measures : {}
  const legacy =
    !('scenarioRules' in value) ||
    Object.values(scenarios).some(
      (scenario) => isObject(scenario) && !('ruleIds' in scenario),
    ) ||
    Object.values(measures).some(
      (measure) => isObject(measure) && 'appliesTo' in measure,
    )
  if (!legacy) return value

  const state: Raw = structuredClone(value)
  const savedMeasures: Raw = isObject(state.measures) ? state.measures : {}
  const savedScenarios: Raw = isObject(state.scenarios) ? state.scenarios : {}
  const rules: Raw = isObject(state.scenarioRules) ? state.scenarioRules : {}

  for (const [scenarioId, scenario] of Object.entries(savedScenarios)) {
    if (!isObject(scenario) || 'ruleIds' in scenario) continue
    const measureIds = Array.isArray(scenario.measureIds)
      ? scenario.measureIds.filter((id): id is string => typeof id === 'string')
      : []
    // One rule per "applies to", specific uses first in measure order.
    const groups = new Map<string, Record<MeasureKind, string | null>>()
    for (const measureId of measureIds) {
      const measure = savedMeasures[measureId]
      if (!isObject(measure) || !isKind(measure.kind)) continue
      const appliesTo = isUse(measure.appliesTo) ? measure.appliesTo : 'all'
      const slots = groups.get(appliesTo) ?? {
        envelope: null,
        heating: null,
        lighting: null,
        pv: null,
      }
      if (slots[measure.kind] === null) slots[measure.kind] = measureId
      groups.set(appliesTo, slots)
    }
    const order = [
      ...[...groups.keys()].filter((key) => key !== 'all'),
      ...(groups.has('all') ? ['all'] : []),
    ]
    const ruleIds: string[] = []
    for (const appliesTo of order) {
      const id = migratedScenarioRuleId(scenarioId, appliesTo)
      rules[id] = {
        id,
        scenarioId,
        name: isUse(appliesTo) ? USE_NAMES[appliesTo] : 'All buildings',
        enabled: true,
        logic: 'all',
        conditions: isUse(appliesTo)
          ? [{ field: 'use', operator: 'equals', value: appliesTo }]
          : [],
        measures: groups.get(appliesTo),
      }
      ruleIds.push(id)
    }
    scenario.ruleIds = ruleIds
    delete scenario.measureIds
    if (typeof scenario.adoptionSeed !== 'number') {
      scenario.adoptionSeed = DEFAULT_ADOPTION_SEED
    }
  }
  for (const measure of Object.values(savedMeasures)) {
    if (isObject(measure)) delete measure.appliesTo
  }

  const groups: Raw = isObject(state.runGroups) ? state.runGroups : {}
  for (const group of Object.values(groups)) {
    if (!isObject(group) || !isObject(group.held)) continue
    const legacyHeld = Object.values(group.held).some(
      (output) => isObject(output) && output.kind === 'scenarioResult',
    )
    if (!legacyHeld) continue
    group.held = {}
    if (group.status === 'open') {
      group.status = 'invalidated'
      group.statusReason =
        'Saved before scenario rules; start a fresh run of Scenario modeling.'
    }
  }

  // Published results came from adoption-scaled savings: a new edit
  // revision of Scenario definitions marks them outdated, and an issue says
  // why. They stay readable until Scenario modeling runs again.
  const results = isObject(state.results) ? state.results : {}
  const published = isObject(results.scenarios) ? results.scenarios : {}
  const workflow = isObject(state.workflow) ? state.workflow : {}
  const stages = isObject(workflow.stages) ? workflow.stages : {}
  const definitions = stages[STAGE_IDS.scenarioDefinitions]
  const modeling = stages[STAGE_IDS.scenarioModeling]
  const modeled =
    Object.keys(published).length > 0 ||
    (isObject(modeling) &&
      modeling.lastRun !== null &&
      modeling.lastRun !== undefined)
  if (modeled && isObject(definitions)) {
    const next = typeof state.nextId === 'number' ? state.nextId : 1
    definitions.editRevision = next
    state.nextId = next + 1
    const issues = Array.isArray(state.issues) ? state.issues : []
    issues.push({
      id: SCENARIO_MIGRATION_ISSUE_ID,
      severity: 'warning',
      message:
        'This project was saved before scenario rules. Each scenario keeps its measures as rules, but its results scaled savings by adoption; adoption now samples whole buildings when results are aggregated. Run Scenario definitions and Scenario modeling again.',
      stageId: STAGE_IDS.scenarioModeling,
      createdAt: new Date().toISOString(),
    })
    state.issues = issues
  }

  return {
    ...state,
    measures: savedMeasures,
    scenarios: savedScenarios,
    scenarioRules: rules,
    results: isObject(state.results)
      ? { ...results, scenarioVersions: results.scenarioVersions ?? {} }
      : state.results,
    runGroups: groups,
  }
}
