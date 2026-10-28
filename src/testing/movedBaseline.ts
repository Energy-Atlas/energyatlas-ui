import type { WorkbenchState } from '../domain/types.ts'

// Test helper: the state with a later working baseline, as after a
// calibration Adopt, every building's demand scaled, under a new run ID.

export function withMovedBaseline(
  state: WorkbenchState,
  factor = 1.1,
  runId = 'run-calibrated',
): WorkbenchState {
  const baseline = state.results.baseline
  if (!baseline) throw new Error('The state has no baseline.')
  return {
    ...state,
    results: {
      ...state.results,
      baseline: {
        ...baseline,
        runId,
        totalKwh: baseline.totalKwh * factor,
        byBuildingKwh: Object.fromEntries(
          Object.entries(baseline.byBuildingKwh).map(([id, kwh]) => [
            id,
            kwh * factor,
          ]),
        ),
      },
    },
  }
}
