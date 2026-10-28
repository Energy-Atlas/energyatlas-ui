import type { StageState, WorkbenchState } from '../types.ts'
import {
  describeAggregation,
  publishedAggregation,
  scenarioBaseline,
} from './rules.ts'

export { KIND_LABELS } from './rules.ts'

// The modeled comparison (jobs rollout plan, slice 6; decision 0032, stage
// 3): the baseline and every published scenario, each aggregated at its
// adoption. Pure; the Measures and scenarios page and the agent share it.

export type ComparisonRow = {
  id: string
  name: string
  totalKwh: number
  peakKw: number
  reductionPercent: number
  /** Modeled with the current inputs, or outdated by later changes. */
  current: boolean
  runId: string
  /** How the scenario was aggregated, such as "40% adoption, seed 42: …"; null for the baseline. */
  adoption: string | null
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
      adoption: null,
    },
  ]
  for (const scenario of Object.values(state.scenarios)) {
    const result = state.results.scenarios[scenario.id]
    if (!result) continue
    const aggregation = publishedAggregation(state, scenario.id)
    // Against the baseline the versions were modeled against.
    const compared = scenarioBaseline(state, scenario.id)?.result ?? baseline
    rows.push({
      id: scenario.id,
      name: scenario.name,
      totalKwh: result.totalKwh,
      peakKw: result.peakKw,
      reductionPercent:
        compared.totalKwh > 0
          ? Math.round((1 - result.totalKwh / compared.totalKwh) * 1000) / 10
          : 0,
      current: modelingCurrent,
      runId: result.runId,
      adoption: aggregation
        ? describeAggregation(aggregation)
        : 'Saved before scenario rules; run Scenario modeling again',
    })
  }
  return rows
}
