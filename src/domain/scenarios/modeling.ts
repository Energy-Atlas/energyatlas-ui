import { GROUP, removeAsset, upsertAsset } from '../assets.ts'
import {
  fromStage,
  megawattHours,
  round,
  usesPvWithoutYield,
  type StageRunContext,
  type StageRunResult,
} from '../simulation.ts'
import type { HeldScenarioOutput, Scenario, WorkbenchState } from '../types.ts'
import { STAGE_IDS } from '../workflow.ts'
import {
  aggregateScenario,
  describeAggregation,
  modelScenarioVersions,
  scenarioRules,
} from './rules.ts'

// Scenario modeling (decision 0032, stage 3): one item per scenario in the
// comparison set. Each item holds the scenario's alternative versions; the
// set publishes together, and each published scenario is aggregated at its
// adoption. Changing adoption later re-aggregates without modeling again.

/** One scenario's held item output, or why it has none. */
export function scenarioItem(
  state: WorkbenchState,
  scenarioId: string,
): { output: HeldScenarioOutput | null; missing: string | null } {
  const scenario = state.scenarios[scenarioId]
  if (!scenario)
    return { output: null, missing: 'The scenario no longer exists.' }
  const versions = modelScenarioVersions(
    state,
    scenarioRules(state, scenario),
    'held',
  )
  return versions
    ? { output: { kind: 'scenarioVersions', versions }, missing: null }
    : {
        output: null,
        missing: 'There are no baseline results to model against.',
      }
}

/** Why held scenario versions cannot be published together, or null. */
export function validateScenarioResults(
  state: WorkbenchState,
  membership: string[],
  held: Record<string, HeldScenarioOutput>,
): string | null {
  if (!state.results.baseline) return 'there are no baseline results'
  for (const id of membership) {
    if (!state.scenarios[id]) return `scenario ${id} no longer exists`
    if (!held[id]) return `scenario ${id} has no held result`
  }
  return null
}

/**
 * Re-aggregates a scenario's published result at its saved adoption and
 * seed; nothing happens when it has no published versions. The result keeps
 * the run that modeled the versions.
 */
export function reaggregateScenario(
  state: WorkbenchState,
  scenario: Scenario,
): boolean {
  const versions = state.results.scenarioVersions[scenario.id]
  if (!versions) return false
  const aggregation = aggregateScenario(scenario, versions)
  state.results.scenarios[scenario.id] = aggregation.result
  const asset = state.assets[`asset:result-${scenario.id}`]
  if (asset) {
    asset.name = `${scenario.name} results`
    asset.summary = `${megawattHours(aggregation.result.totalKwh)}/yr at ${describeAggregation(aggregation)} (synthetic)`
  }
  return true
}

/**
 * Publishes a requested comparison set at once: the modeled scenarios'
 * versions replace the earlier set and are aggregated at each scenario's
 * adoption; results of scenarios left out of it are withdrawn.
 */
export function publishScenarioResults(
  state: WorkbenchState,
  membership: string[],
  held: Record<string, HeldScenarioOutput>,
  context: StageRunContext,
): StageRunResult {
  const baseline = state.results.baseline
  if (!baseline) {
    return {
      ok: false,
      message: 'No baseline results. Run "Baseline model setup".',
    }
  }
  const provenance = fromStage(STAGE_IDS.scenarioModeling, context)
  for (const id of Object.keys(state.results.scenarios)) {
    if (!membership.includes(id)) removeAsset(state, `asset:result-${id}`)
  }
  state.results.scenarios = {}
  state.results.scenarioVersions = {}
  let bestReduction = 0
  let bestAt = ''
  for (const id of membership) {
    const scenario = state.scenarios[id]
    const output = held[id]
    if (!scenario || !output) continue
    const versions = { ...output.versions, runId: context.runId }
    state.results.scenarioVersions[id] = versions
    const aggregation = aggregateScenario(scenario, versions)
    state.results.scenarios[id] = aggregation.result
    const reduction = 1 - aggregation.result.totalKwh / baseline.totalKwh
    if (bestAt === '' || reduction > bestReduction) {
      bestReduction = reduction
      bestAt = `"${scenario.name}" at ${scenario.adoptionPercent}% adoption, seed ${scenario.adoptionSeed}`
    }
    upsertAsset(state, {
      id: `asset:result-${id}`,
      kind: 'energyResult',
      name: `${scenario.name} results`,
      parentId: GROUP.energyResults,
      provenance,
      capability: 'dashboard.comparison',
      summary: `${megawattHours(aggregation.result.totalKwh)}/yr at ${describeAggregation(aggregation)} (synthetic)`,
      entityIds: [id],
    })
  }
  return {
    ok: true,
    summary: `Modeled ${membership.length} scenario(s) as one comparison set; largest reduction ${round(bestReduction * 100, 1)}%${bestAt ? ` (${bestAt}, as published; later adoption changes re-aggregate)` : ''}.`,
    warnings: usesPvWithoutYield(state)
      ? ['PV measures had no effect because PV yield was not estimated.']
      : [],
  }
}
