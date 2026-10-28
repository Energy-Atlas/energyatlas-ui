import {
  aggregateScenario,
  baselineChangeNote,
  scenarioBaseline,
} from '../../domain/scenarios/rules.ts'
import type { ResultSet, Scenario, WorkbenchState } from '../../domain/types.ts'

/** Charts compare at most three scenarios: the palette is validated for three slots. */
export const MAX_CHARTED_SCENARIOS = 3

export const MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
]

export type ChartedScenario = {
  scenario: Scenario
  /**
   * Categorical color slot: the scenario's position in the comparison set.
   * Changing the set can reassign colors; left-out scenarios take no slot.
   */
  slot: number
  /** Result of the last scenario modeling run, if any. */
  modeled: ResultSet | null
  /** What the dashboard shows: a preview when adoption is overridden, else the modeled result. */
  shown: ResultSet | null
  /** Unsaved what-if adoption, when it differs from the saved value. */
  previewAdoption: number | null
  /**
   * Whether a what-if adoption can be shown: the scenario has published
   * alternative versions to sample from (decision 0032, stage 3).
   */
  canPreview: boolean
  /**
   * Reduction of annual demand against the baseline the scenario was modeled
   * against (decision 0032, stage 3), in percent.
   */
  reductionPercent: number | null
  /** Which baseline run the reduction compares with, when the working baseline has moved on. */
  baselineNote: string | null
}

export type DashboardData = {
  baseline: ResultSet | null
  scenarios: ChartedScenario[]
  /** Scenarios beyond the charted three, listed by name. */
  uncharted: string[]
  /** Scenarios left out of the comparison set; they take no chart slot. */
  leftOut: string[]
}

/**
 * Scenarios in chart-slot order: those included in the comparison set, in
 * creation order. Shared by the dashboard and chart specifications.
 */
export function chartedScenarioOrder(state: WorkbenchState): Scenario[] {
  return Object.values(state.scenarios).filter((scenario) => scenario.included)
}

function round(value: number, digits: number): number {
  const factor = 10 ** digits
  return Math.round(value * factor) / factor
}

export function buildDashboardData(
  state: WorkbenchState,
  previews: Record<string, number>,
): DashboardData {
  const baseline = state.results.baseline
  const all = chartedScenarioOrder(state)

  const scenarios = all
    .slice(0, MAX_CHARTED_SCENARIOS)
    .map((scenario, slot): ChartedScenario => {
      const modeled = state.results.scenarios[scenario.id] ?? null
      const versions = state.results.scenarioVersions[scenario.id]
      const override = previews[scenario.id]
      const previewAdoption =
        versions &&
        override !== undefined &&
        override !== scenario.adoptionPercent
          ? override
          : null
      // A what-if adoption re-aggregates the published versions, as Apply will.
      const shown =
        previewAdoption !== null && versions
          ? aggregateScenario(scenario, versions, previewAdoption).result
          : modeled
      const compared = scenarioBaseline(state, scenario.id)?.result ?? null
      const reductionPercent =
        compared && shown && compared.totalKwh > 0
          ? round((1 - shown.totalKwh / compared.totalKwh) * 100, 1)
          : null
      return {
        scenario,
        slot,
        modeled,
        shown,
        previewAdoption,
        canPreview: Boolean(versions),
        reductionPercent,
        baselineNote: modeled ? baselineChangeNote(state, scenario.id) : null,
      }
    })

  return {
    baseline,
    scenarios,
    uncharted: all
      .slice(MAX_CHARTED_SCENARIOS)
      .map((scenario) => scenario.name),
    leftOut: Object.values(state.scenarios)
      .filter((scenario) => !scenario.included)
      .map((scenario) => scenario.name),
  }
}
