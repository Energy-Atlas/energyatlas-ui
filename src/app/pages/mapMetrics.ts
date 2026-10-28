import { scenarioBaseline } from '../../domain/scenarios/rules.ts'
import type { WorkbenchState } from '../../domain/types.ts'

export type MetricId =
  'floors' | 'pvYield' | 'baselineDemand' | 'scenarioReduction'

export type MetricDefinition = {
  id: MetricId
  label: string
  unit: string
  /** What to run when the metric has no data yet. */
  requirement: string
}

export const METRICS: MetricDefinition[] = [
  {
    id: 'floors',
    label: 'Floors',
    unit: '',
    requirement: 'Run "Geospatial data enriching".',
  },
  {
    id: 'pvYield',
    label: 'PV yield',
    unit: 'MWh/yr',
    requirement: 'Run "Shading calculation / PV yield estimation".',
  },
  {
    id: 'baselineDemand',
    label: 'Baseline demand',
    unit: 'MWh/yr',
    requirement: 'Run "Baseline model setup".',
  },
  {
    id: 'scenarioReduction',
    label: 'Scenario reduction',
    unit: '%',
    requirement: 'Run "Scenario modeling".',
  },
]

export type MetricValues = {
  /** null where a building has no value for this metric. */
  values: Record<string, number | null>
  min: number
  max: number
  available: boolean
  /** For scenario reduction: the scenario shown. */
  scenarioName: string | null
}

function round(value: number, digits: number): number {
  const factor = 10 ** digits
  return Math.round(value * factor) / factor
}

/** Per-building values for a map metric. All values are synthetic. */
export function computeMetric(
  state: WorkbenchState,
  metric: MetricId,
): MetricValues {
  const values: Record<string, number | null> = {}
  let scenarioName: string | null = null

  const baseline = state.results.baseline
  const firstScenario = Object.values(state.scenarios).find(
    (scenario) => state.results.scenarios[scenario.id],
  )
  const scenarioResult = firstScenario
    ? state.results.scenarios[firstScenario.id]
    : undefined
  // A scenario's reduction compares with the baseline it was modeled against.
  const scenarioBase = firstScenario
    ? (scenarioBaseline(state, firstScenario.id)?.result ?? baseline)
    : baseline
  if (metric === 'scenarioReduction' && firstScenario) {
    scenarioName = firstScenario.name
  }

  for (const id of state.buildingIds) {
    const building = state.buildings[id]
    if (!building) continue
    switch (metric) {
      case 'floors':
        values[id] = building.floors
        break
      case 'pvYield':
        values[id] =
          building.pvYieldKwh === null
            ? null
            : round(building.pvYieldKwh / 1000, 1)
        break
      case 'baselineDemand': {
        const kwh = baseline?.byBuildingKwh[id]
        values[id] = kwh === undefined ? null : round(kwh / 1000, 1)
        break
      }
      case 'scenarioReduction': {
        const before = scenarioBase?.byBuildingKwh[id]
        const after = scenarioResult?.byBuildingKwh[id]
        values[id] =
          before === undefined || after === undefined || before <= 0
            ? null
            : round(((before - after) / before) * 100, 1)
        break
      }
    }
  }

  const present = Object.values(values).filter(
    (value): value is number => value !== null,
  )
  return {
    values,
    min: present.length > 0 ? Math.min(...present) : 0,
    max: present.length > 0 ? Math.max(...present) : 0,
    available: present.length > 0,
    scenarioName,
  }
}
