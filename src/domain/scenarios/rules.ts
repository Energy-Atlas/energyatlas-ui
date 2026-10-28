import {
  CONDITION_FIELDS,
  buildingSubject,
  firstMatches,
  prepareRules,
  type PreparedRule,
  type RuleWarning,
} from '../rules/conditions.ts'
import { makeResultSet } from '../simulation.ts'
import type {
  Building,
  BuildingMeasures,
  ConditionField,
  Measure,
  MeasureKind,
  ResultSet,
  Scenario,
  ScenarioRule,
  ScenarioVersions,
  WorkbenchState,
} from '../types.ts'
import { MEASURE_KINDS } from '../types.ts'

// Scenario rules (decision 0032, stage 3): RC's measure rule shape
// (ScenarioDesignerController.cs:946-978) on the shared rule engine. A
// scenario's rules are tried top first; each measure category takes the
// first enabled rule that matches the building and sets it. Scenario modeling
// gives every affected building an alternative version; adoption samples
// buildings deterministically, by a hash of a fixed seed and the building id,
// when results are aggregated (RC's CapRealizationSampler), never inside the
// rules. Pure; the commands, the job, the pages, and the agent share it.

export const KIND_LABELS: Record<MeasureKind, string> = {
  envelope: 'Envelope',
  heating: 'Heating',
  lighting: 'Lighting',
  pv: 'Rooftop PV',
}

/** A category inside a sentence, such as "heating" or "PV". */
export function kindNoun(kind: MeasureKind): string {
  return kind === 'pv' ? 'PV' : KIND_LABELS[kind].toLowerCase()
}

/** Savings of a building's non-PV measures add up to at most this percent. */
export const MAX_SAVINGS_PERCENT = 60

/** The seed a new scenario samples adoption with, as RC's result viewer defaults. */
export const DEFAULT_ADOPTION_SEED = 42

export function emptyMeasures(): Record<MeasureKind, string | null> {
  return { envelope: null, heating: null, lighting: null, pv: null }
}

export function emptyBuildingMeasures(): BuildingMeasures {
  return { envelope: null, heating: null, lighting: null, pv: null }
}

/** A scenario's rules in order, as evaluation reads them. */
export function scenarioRules(
  state: Pick<WorkbenchState, 'scenarioRules'>,
  scenario: Pick<Scenario, 'ruleIds'>,
): ScenarioRule[] {
  return scenario.ruleIds.flatMap((id) => {
    const rule = state.scenarioRules[id]
    return rule ? [rule] : []
  })
}

/** Every measure id a scenario's rules assign, in rule order, without repeats. */
export function scenarioMeasureIds(
  state: Pick<WorkbenchState, 'scenarioRules'>,
  scenario: Pick<Scenario, 'ruleIds'>,
): string[] {
  const ids = new Set<string>()
  for (const rule of scenarioRules(state, scenario)) {
    for (const kind of MEASURE_KINDS) {
      const id = rule.measures[kind]
      if (id !== null) ids.add(id)
    }
  }
  return [...ids]
}

/** The enabled rules ready to evaluate, with RC's coded warnings. */
export function prepareScenarioRules(
  state: Pick<WorkbenchState, 'measures'>,
  rules: ScenarioRule[],
): {
  prepared: PreparedRule<MeasureKind, ConditionField>[]
  warnings: RuleWarning[]
} {
  return prepareRules(
    rules.map((rule) => ({ ...rule, slots: rule.measures })),
    MEASURE_KINDS,
    (kind, measureId) => state.measures[measureId]?.kind === kind,
    'measure',
  )
}

/** The measures the rules give one building, by the rule that set each. */
export function assignMeasures(
  prepared: PreparedRule<MeasureKind, ConditionField>[],
  building: Building,
): { measures: BuildingMeasures; matched: string[] } {
  const { winners, matched } = firstMatches(
    CONDITION_FIELDS,
    prepared,
    MEASURE_KINDS,
    buildingSubject(building),
  )
  const measures = emptyBuildingMeasures()
  for (const kind of MEASURE_KINDS) {
    const winner = winners[kind]
    measures[kind] = winner
      ? {
          measureId: winner.value,
          ruleId: winner.ruleId,
          ruleName: winner.ruleName,
        }
      : null
  }
  return { measures, matched }
}

export function takesAnyMeasure(measures: BuildingMeasures): boolean {
  return MEASURE_KINDS.some((kind) => measures[kind] !== null)
}

/**
 * A building's synthetic demand with its measures, its alternative version:
 * non-PV savings add up (at most 60%), and a PV measure subtracts the roof's
 * estimated yield. Not a physical calculation.
 */
export function alternativeKwh(
  baseKwh: number,
  building: Pick<Building, 'pvYieldKwh'> | undefined,
  measures: Measure[],
): number {
  const savingsPercent = Math.min(
    MAX_SAVINGS_PERCENT,
    measures
      .filter((measure) => measure.kind !== 'pv')
      .reduce((sum, measure) => sum + measure.savingsPercent, 0),
  )
  const pvOffset = measures.some((measure) => measure.kind === 'pv')
    ? (building?.pvYieldKwh ?? 0)
    : 0
  return Math.max(
    0,
    Math.round(baseKwh * (1 - savingsPercent / 100) - pvOffset),
  )
}

/**
 * A building's position in [0, 1) for a seed: a 32-bit FNV-1a hash of
 * "seed|building id" with a final mix. RC hashes the same string with
 * SHA-256 (CapRealizationSampler.cs); the demo needs a synchronous hash and
 * only the same behaviour: fixed per seed and building, uniform enough.
 */
export function adoptionUnit(seed: number, buildingId: string): number {
  const text = `${seed}|${buildingId}`
  let hash = 0x811c9dc5
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  // Murmur3's finalizer spreads nearby inputs across the range.
  hash ^= hash >>> 16
  hash = Math.imul(hash, 0x85ebca6b)
  hash ^= hash >>> 13
  hash = Math.imul(hash, 0xc2b2ae35)
  hash ^= hash >>> 16
  return (hash >>> 0) / 0x1_0000_0000
}

/**
 * Whether an affected building adopts at a percentage: its hash falls below
 * the fraction, as in RC. Raising adoption only adds buildings.
 */
export function isAdopted(
  seed: number,
  buildingId: string,
  adoptionPercent: number,
): boolean {
  const fraction = Math.min(1, Math.max(0, adoptionPercent / 100))
  return adoptionUnit(seed, buildingId) < fraction
}

/** The buildings to evaluate: those the baseline modeled, or every building before one exists. */
function evaluatedIds(
  state: Pick<WorkbenchState, 'results' | 'buildingIds'>,
): string[] {
  const baseline = state.results.baseline
  return baseline ? Object.keys(baseline.byBuildingKwh) : state.buildingIds
}

/**
 * Each affected building's alternative version against the current
 * baseline; null without baseline results. Unaffected buildings keep the
 * baseline and get no version.
 */
export function modelScenarioVersions(
  state: Pick<
    WorkbenchState,
    'results' | 'buildings' | 'buildingIds' | 'measures' | 'scenarioRules'
  >,
  rules: ScenarioRule[],
  runId: string,
): ScenarioVersions | null {
  const baseline = state.results.baseline
  if (!baseline) return null
  const { prepared } = prepareScenarioRules(state, rules)
  const versions: ScenarioVersions = {
    runId,
    baselineRunId: baseline.runId,
    baseKwh: { ...baseline.byBuildingKwh },
    alternativeKwh: {},
    measures: {},
  }
  for (const [buildingId, kwh] of Object.entries(baseline.byBuildingKwh)) {
    const building = state.buildings[buildingId]
    if (!building) continue
    const { measures } = assignMeasures(prepared, building)
    if (!takesAnyMeasure(measures)) continue
    const taken = MEASURE_KINDS.flatMap((kind) => {
      const measure = measures[kind]
        ? state.measures[measures[kind].measureId]
        : undefined
      return measure ? [measure] : []
    })
    versions.measures[buildingId] = measures
    versions.alternativeKwh[buildingId] = alternativeKwh(kwh, building, taken)
  }
  return versions
}

export type Aggregation = {
  result: ResultSet
  /** Affected buildings that adopt their alternative version, in id order. */
  adoptedIds: string[]
  /** Affected buildings: those with an alternative version. */
  eligible: number
  adoptionPercent: number
  seed: number
}

/**
 * A scenario's result at an adoption: each affected building whose hash
 * falls below the adoption fraction takes its alternative version, every
 * other building its baseline (RC's seeded penetration). `adoptionPercent`
 * overrides the scenario's, for what-if previews.
 */
export function aggregateScenario(
  scenario: Pick<Scenario, 'id' | 'name' | 'adoptionPercent' | 'adoptionSeed'>,
  versions: ScenarioVersions,
  adoptionPercent = scenario.adoptionPercent,
): Aggregation {
  const byBuildingKwh: Record<string, number> = {}
  const adoptedIds: string[] = []
  for (const [buildingId, base] of Object.entries(versions.baseKwh)) {
    const alternative = versions.alternativeKwh[buildingId]
    if (
      alternative !== undefined &&
      isAdopted(scenario.adoptionSeed, buildingId, adoptionPercent)
    ) {
      byBuildingKwh[buildingId] = alternative
      adoptedIds.push(buildingId)
    } else {
      byBuildingKwh[buildingId] = base
    }
  }
  adoptedIds.sort()
  return {
    result: makeResultSet(
      `result:${scenario.id}`,
      scenario.name,
      versions.runId,
      byBuildingKwh,
    ),
    adoptedIds,
    eligible: Object.keys(versions.alternativeKwh).length,
    adoptionPercent,
    seed: scenario.adoptionSeed,
  }
}

/** How a published scenario result was aggregated, in words for pages and exports. */
export function describeAggregation(aggregation: Aggregation): string {
  return `${aggregation.adoptionPercent}% adoption, seed ${aggregation.seed}: ${aggregation.adoptedIds.length} of ${aggregation.eligible} affected buildings adopt`
}

/** A published scenario's aggregation at its saved adoption, or null when it has no versions. */
export function publishedAggregation(
  state: Pick<WorkbenchState, 'scenarios' | 'results'>,
  scenarioId: string,
): Aggregation | null {
  const scenario = state.scenarios[scenarioId]
  const versions = state.results.scenarioVersions[scenarioId]
  return scenario && versions ? aggregateScenario(scenario, versions) : null
}

export type ScenarioRulePreview = {
  ruleId: string
  /** Buildings whose attributes the rule matches. */
  matched: number
  /** Buildings whose measure of each category this rule sets. */
  takes: Record<MeasureKind, number>
  /** Buildings the rule matches, in building order. */
  buildingIds: string[]
}

export type ScenarioEstimate = {
  baselineKwh: number
  /** At the draft adoption, sampled as aggregation will be. */
  scenarioKwh: number
  reductionPercent: number
  /** If every affected building adopted. */
  fullKwh: number
  fullReductionPercent: number
}

export type ScenarioRulesPreview = {
  /** Per rule in list order; disabled and skipped rules match nothing. */
  rules: ScenarioRulePreview[]
  /** Buildings evaluated: those the baseline modeled, or every building before. */
  buildings: number
  /** Buildings that take at least one measure, in building order. */
  affectedIds: string[]
  /** Buildings that take no measure, in building order. */
  unaffectedIds: string[]
  /** Buildings that take a measure of each category. */
  byKind: Record<MeasureKind, number>
  /** Affected buildings that adopt at the draft adoption and seed. */
  adoptedIds: string[]
  warnings: RuleWarning[]
  /** Null before baseline results exist. */
  estimate: ScenarioEstimate | null
  /** Why there is no estimate, when there is none. */
  reason: string | null
  /**
   * Buildings whose measures would differ from the published versions; null
   * when the scenario has none published.
   */
  changes: number | null
  /** Measures each affected building takes, before modeling. */
  byBuilding: Record<string, BuildingMeasures>
}

const zeroCounts = (): Record<MeasureKind, number> => ({
  envelope: 0,
  heating: 0,
  lighting: 0,
  pv: 0,
})

function sameMeasures(a: BuildingMeasures, b: BuildingMeasures): boolean {
  return MEASURE_KINDS.every(
    (kind) => (a[kind]?.measureId ?? null) === (b[kind]?.measureId ?? null),
  )
}

const percentLower = (kwh: number, baselineKwh: number) =>
  baselineKwh > 0 ? Math.round((1 - kwh / baselineKwh) * 1000) / 10 : 0

/**
 * What a scenario's rules would do, before modeling: per rule, the
 * buildings it matches and the measures it takes; the buildings affected and
 * those that adopt; and, with baseline results, the estimate the job and
 * aggregation would produce. Shared by the page, Properties, and the agent,
 * so a preview and a run never disagree.
 */
export function previewScenarioRules(
  state: Pick<
    WorkbenchState,
    'results' | 'buildings' | 'buildingIds' | 'measures' | 'scenarioRules'
  >,
  draft: {
    id?: string
    rules: ScenarioRule[]
    adoptionPercent: number
    adoptionSeed: number
  },
): ScenarioRulesPreview {
  const { prepared, warnings } = prepareScenarioRules(state, draft.rules)
  const previews = new Map<string, ScenarioRulePreview>(
    draft.rules.map((rule) => [
      rule.id,
      { ruleId: rule.id, matched: 0, takes: zeroCounts(), buildingIds: [] },
    ]),
  )
  const byKind = zeroCounts()
  const affectedIds: string[] = []
  const unaffectedIds: string[] = []
  const adoptedIds: string[] = []
  const byBuilding: Record<string, BuildingMeasures> = {}
  const ids = evaluatedIds(state)
  for (const id of ids) {
    const building = state.buildings[id]
    if (!building) continue
    const { measures, matched } = assignMeasures(prepared, building)
    for (const ruleId of matched) {
      const preview = previews.get(ruleId)
      if (!preview) continue
      preview.matched += 1
      preview.buildingIds.push(id)
    }
    if (!takesAnyMeasure(measures)) {
      unaffectedIds.push(id)
      continue
    }
    byBuilding[id] = measures
    affectedIds.push(id)
    if (isAdopted(draft.adoptionSeed, id, draft.adoptionPercent)) {
      adoptedIds.push(id)
    }
    for (const kind of MEASURE_KINDS) {
      const winner = measures[kind]
      if (!winner) continue
      byKind[kind] += 1
      const preview = previews.get(winner.ruleId)
      if (preview) preview.takes[kind] += 1
    }
  }

  const published = draft.id
    ? state.results.scenarioVersions[draft.id]
    : undefined
  let changes: number | null = null
  if (published) {
    changes = 0
    const empty = emptyBuildingMeasures()
    for (const id of ids) {
      if (
        !sameMeasures(byBuilding[id] ?? empty, published.measures[id] ?? empty)
      )
        changes += 1
    }
  }

  const baseline = state.results.baseline
  let estimate: ScenarioEstimate | null = null
  if (baseline) {
    const versions = modelScenarioVersions(state, draft.rules, 'preview')
    if (versions) {
      const scenario = {
        id: draft.id ?? 'preview',
        name: 'Preview',
        adoptionPercent: draft.adoptionPercent,
        adoptionSeed: draft.adoptionSeed,
      }
      const scenarioKwh = aggregateScenario(scenario, versions).result.totalKwh
      const fullKwh = aggregateScenario(scenario, versions, 100).result.totalKwh
      estimate = {
        baselineKwh: baseline.totalKwh,
        scenarioKwh,
        reductionPercent: percentLower(scenarioKwh, baseline.totalKwh),
        fullKwh,
        fullReductionPercent: percentLower(fullKwh, baseline.totalKwh),
      }
    }
  }

  return {
    rules: [...previews.values()],
    buildings: ids.length,
    affectedIds,
    unaffectedIds,
    byKind,
    adoptedIds,
    warnings,
    estimate,
    reason: estimate
      ? null
      : 'Estimates need baseline results. Run "Baseline model setup".',
    changes,
    byBuilding,
  }
}
