import { computeScenarioResult } from '../simulation.ts'
import type {
  Measure,
  MeasureKind,
  Scenario,
  StageState,
  WorkbenchState,
} from '../types.ts'

// Scenario composition rules, affected-building previews, and the modeled
// comparison (jobs rollout plan, slice 6). Pure; the commands, the Creator
// page, and the comparison table share them.

export const KIND_LABELS: Record<MeasureKind, string> = {
  envelope: 'Envelope',
  heating: 'Heating',
  lighting: 'Lighting',
  pv: 'Rooftop PV',
}

/** A scenario combines at most one measure of each kind; returns the first conflict, or null. */
export function compositionConflict(
  measures: Record<string, Measure>,
  measureIds: string[],
): string | null {
  const byKind = new Map<MeasureKind, string>()
  for (const id of measureIds) {
    const measure = measures[id]
    if (!measure) continue
    const other = byKind.get(measure.kind)
    if (other) {
      return `"${other}" and "${measure.name}" are both ${KIND_LABELS[measure.kind].toLowerCase()} measures. A scenario combines at most one measure of each kind.`
    }
    byKind.set(measure.kind, measure.name)
  }
  return null
}

export type MeasurePreview = {
  measureId: string
  name: string
  /** Modeled buildings the measure applies to. */
  buildings: number
}

export type ScenarioPreview = {
  available: boolean
  /** Why no estimate is shown, when one is not. */
  reason: string | null
  measures: MeasurePreview[]
  /** Modeled buildings any measure applies to. */
  affected: number
  baselineKwh: number
  scenarioKwh: number
  reductionPercent: number
}

/** Affected buildings and an estimate against the current baseline, for a draft scenario. */
export function previewScenario(
  state: WorkbenchState,
  draft: Pick<Scenario, 'measureIds' | 'adoptionPercent'>,
): ScenarioPreview {
  const baseline = state.results.baseline
  const measures = draft.measureIds.flatMap((id) => {
    const measure = state.measures[id]
    return measure ? [measure] : []
  })
  // With results, the buildings a measure changes; before, every building it applies to.
  const modeled = baseline
    ? Object.keys(baseline.byBuildingKwh)
    : state.buildingIds
  const applies = (measure: Measure, buildingId: string) =>
    measure.appliesTo === 'all' ||
    state.buildings[buildingId]?.use === measure.appliesTo
  const affected = new Set<string>()
  const rows = measures.map((measure) => {
    let count = 0
    for (const id of modeled) {
      if (applies(measure, id)) {
        count += 1
        affected.add(id)
      }
    }
    return { measureId: measure.id, name: measure.name, buildings: count }
  })
  if (!baseline) {
    return {
      available: false,
      reason: 'Estimates need baseline results. Run "Baseline model setup".',
      measures: rows,
      affected: 0,
      baselineKwh: 0,
      scenarioKwh: 0,
      reductionPercent: 0,
    }
  }
  const result = computeScenarioResult(
    state,
    { id: 'preview', name: 'Preview', included: true, ...draft },
    { runId: 'preview' },
  )
  const scenarioKwh = result?.totalKwh ?? baseline.totalKwh
  return {
    available: true,
    reason: null,
    measures: rows,
    affected: affected.size,
    baselineKwh: baseline.totalKwh,
    scenarioKwh,
    reductionPercent:
      baseline.totalKwh > 0
        ? Math.round((1 - scenarioKwh / baseline.totalKwh) * 1000) / 10
        : 0,
  }
}

export type ComparisonRow = {
  id: string
  name: string
  totalKwh: number
  peakKw: number
  reductionPercent: number
  /** Modeled with the current inputs, or outdated by later changes. */
  current: boolean
  runId: string
}

/** Baseline and every modeled scenario, with currentness from the stage states. */
export function compareScenarios(
  state: WorkbenchState,
  states: Record<string, StageState>,
  modelingStageId: string,
  baselineStageId: string,
): ComparisonRow[] {
  const baseline = state.results.baseline
  if (!baseline) return []
  const baselineCurrent = states[baselineStageId] === 'executed'
  const modelingCurrent = states[modelingStageId] === 'executed'
  const rows: ComparisonRow[] = [
    {
      id: 'baseline',
      name: 'Baseline',
      totalKwh: baseline.totalKwh,
      peakKw: baseline.peakKw,
      reductionPercent: 0,
      current: baselineCurrent,
      runId: baseline.runId,
    },
  ]
  for (const scenario of Object.values(state.scenarios)) {
    const result = state.results.scenarios[scenario.id]
    if (!result) continue
    rows.push({
      id: scenario.id,
      name: scenario.name,
      totalKwh: result.totalKwh,
      peakKw: result.peakKw,
      reductionPercent:
        baseline.totalKwh > 0
          ? Math.round((1 - result.totalKwh / baseline.totalKwh) * 1000) / 10
          : 0,
      current: modelingCurrent,
      runId: result.runId,
    })
  }
  return rows
}
