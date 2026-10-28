import type { BuildingUse, WorkbenchState } from '../domain/types.ts'
import { MEASURE_KINDS } from '../domain/types.ts'

// Test helper: a save as it was before scenario rules (decision 0032, stage
// 3): scenarios list their measures, measures carry the building use they
// apply to, and Scenario modeling held whole result sets.

export type LegacyScenarioSave = Record<string, unknown> & {
  measures: Record<string, Record<string, unknown>>
  scenarios: Record<string, Record<string, unknown>>
  runGroups: Record<string, Record<string, unknown>>
  results: Record<string, unknown>
}

/**
 * The state with each scenario's rule measures as one measure list, each
 * measure applying to the use given in `appliesTo` (all buildings when
 * left out), and no scenario rules, seeds, or versions.
 */
export function legacyScenarioSave(
  state: WorkbenchState,
  appliesTo: Record<string, BuildingUse> = {},
): LegacyScenarioSave {
  const copy = JSON.parse(JSON.stringify(state)) as Record<string, unknown>
  const measures = Object.fromEntries(
    Object.values(state.measures).map((measure) => [
      measure.id,
      { ...measure, appliesTo: appliesTo[measure.id] ?? 'all' },
    ]),
  )
  const scenarios = Object.fromEntries(
    Object.values(state.scenarios).map((scenario) => {
      const measureIds = scenario.ruleIds.flatMap((ruleId) => {
        const rule = state.scenarioRules[ruleId]
        return rule
          ? MEASURE_KINDS.flatMap((kind) => {
              const id = rule.measures[kind]
              return id ? [id] : []
            })
          : []
      })
      return [
        scenario.id,
        {
          id: scenario.id,
          name: scenario.name,
          measureIds: [...new Set(measureIds)],
          adoptionPercent: scenario.adoptionPercent,
          included: scenario.included,
        },
      ]
    }),
  )
  const results = { ...state.results } as Record<string, unknown>
  delete results.scenarioVersions
  const runGroups = JSON.parse(JSON.stringify(state.runGroups)) as Record<
    string,
    Record<string, unknown>
  >
  for (const group of Object.values(runGroups)) {
    const held = group.held as Record<string, Record<string, unknown>>
    for (const [key, output] of Object.entries(held)) {
      if (output.kind !== 'scenarioVersions') continue
      held[key] = {
        kind: 'scenarioResult',
        result: state.results.scenarios[key] ?? null,
      }
    }
  }
  delete copy.scenarioRules
  return {
    ...copy,
    measures,
    scenarios,
    results: JSON.parse(JSON.stringify(results)) as Record<string, unknown>,
    runGroups,
  }
}
