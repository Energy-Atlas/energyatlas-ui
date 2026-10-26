import { describe, expect, test } from 'vitest'
import { runStageNow } from '../../domain/jobs/runNow.ts'
import { createWorkbench, type Workbench } from '../../domain/workbench.ts'
import { STAGE_IDS } from '../../domain/workflow.ts'
import { buildDashboardData } from './dashboardData.ts'

function runStage(workbench: Workbench, stageId: string) {
  runStageNow(workbench, stageId)
}

function modeledProject(scenarioCount: number): Workbench {
  const workbench = createWorkbench()
  for (const stageId of [
    STAGE_IDS.location,
    STAGE_IDS.enrichment,
    STAGE_IDS.schema,
    STAGE_IDS.preprocessing,
  ]) {
    runStage(workbench, stageId)
  }
  workbench.execute({
    type: 'workflow.setStageSkipped',
    input: { stageId: STAGE_IDS.shading, skipped: true },
  })
  runStage(workbench, STAGE_IDS.archetypes)
  runStage(workbench, STAGE_IDS.baseline)
  workbench.execute({
    type: 'measure.create',
    input: {
      name: 'Lighting',
      kind: 'lighting',
      savingsPercent: 20,
      appliesTo: 'all',
    },
  })
  const measureId = Object.keys(workbench.getState().measures)[0] ?? ''
  for (let index = 1; index <= scenarioCount; index++) {
    workbench.execute({
      type: 'scenario.create',
      input: {
        name: `Scenario ${index}`,
        measureIds: [measureId],
        adoptionPercent: index * 20,
      },
    })
  }
  runStage(workbench, STAGE_IDS.scenarioDefinitions)
  runStage(workbench, STAGE_IDS.scenarioModeling)
  return workbench
}

describe('buildDashboardData', () => {
  test('has no baseline before the baseline stage runs', () => {
    const data = buildDashboardData(createWorkbench().getState(), {})
    expect(data.baseline).toBeNull()
    expect(data.scenarios).toEqual([])
  })

  test('charts the first three scenarios with fixed slots and lists the rest', () => {
    const data = buildDashboardData(modeledProject(4).getState(), {})
    expect(
      data.scenarios.map((item) => [item.scenario.name, item.slot]),
    ).toEqual([
      ['Scenario 1', 0],
      ['Scenario 2', 1],
      ['Scenario 3', 2],
    ])
    expect(data.uncharted).toEqual(['Scenario 4'])
    expect(data.scenarios[1]?.reductionPercent).toBeCloseTo(8, 0)
  })

  test('previews a different adoption without changing the model', () => {
    const workbench = modeledProject(1)
    const state = workbench.getState()
    const scenarioId = Object.keys(state.scenarios)[0] ?? ''

    const same = buildDashboardData(state, { [scenarioId]: 20 })
    expect(same.scenarios[0]?.previewAdoption).toBeNull()

    const preview = buildDashboardData(state, { [scenarioId]: 100 })
    const item = preview.scenarios[0]
    expect(item?.previewAdoption).toBe(100)
    expect(item?.reductionPercent).toBeCloseTo(20, 0)
    expect(item?.shown?.totalKwh).toBeLessThan(item?.modeled?.totalKwh ?? 0)
    expect(workbench.getState().scenarios[scenarioId]?.adoptionPercent).toBe(20)
  })
})
