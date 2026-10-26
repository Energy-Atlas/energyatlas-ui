import { describe, expect, test } from 'vitest'
import { runStageNow } from '../../domain/jobs/runNow.ts'
import { createWorkbench, type Workbench } from '../../domain/workbench.ts'
import { STAGE_IDS } from '../../domain/workflow.ts'
import { computeMetric } from './mapMetrics.ts'

function runStage(workbench: Workbench, stageId: string) {
  runStageNow(workbench, stageId)
}

describe('computeMetric', () => {
  test('reports unavailable metrics until their stage has run', () => {
    const workbench = createWorkbench()
    runStage(workbench, STAGE_IDS.location)

    const floors = computeMetric(workbench.getState(), 'floors')
    expect(floors.available).toBe(false)
    expect(Object.keys(floors.values)).toHaveLength(464)

    runStage(workbench, STAGE_IDS.enrichment)
    const enriched = computeMetric(workbench.getState(), 'floors')
    expect(enriched.available).toBe(true)
    expect(enriched.min).toBeGreaterThanOrEqual(1)
    expect(enriched.max).toBeLessThanOrEqual(11)
    expect(computeMetric(workbench.getState(), 'pvYield').available).toBe(false)
  })

  test('computes scenario reduction against the baseline per building', () => {
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
    workbench.execute({
      type: 'scenario.create',
      input: {
        name: 'All buildings',
        measureIds: [measureId],
        adoptionPercent: 100,
      },
    })
    runStage(workbench, STAGE_IDS.scenarioDefinitions)
    runStage(workbench, STAGE_IDS.scenarioModeling)

    const reduction = computeMetric(workbench.getState(), 'scenarioReduction')
    expect(reduction.scenarioName).toBe('All buildings')
    expect(reduction.available).toBe(true)
    expect(reduction.max).toBeCloseTo(20, 0)
  })
})
