import { describe, expect, test } from 'vitest'
import { buildFixture } from '../../server/fixtures.ts'
import { finishJobNow, runStageNow } from '../jobs/runNow.ts'
import { retryBlocker } from '../jobs/runGroups.ts'
import { createWorkbench, type Workbench } from '../workbench.ts'
import { STAGE_IDS, deriveStageStates } from '../workflow.ts'
import {
  METER_SERIES,
  adoptBlocker,
  findMeter,
  fitBlocker,
  fitFactor,
  fitMetrics,
  meterIssues,
  meteredKwh,
} from './calibration.ts'

const S = STAGE_IDS

function complete(): Workbench {
  return createWorkbench({
    initialState: buildFixture('complete', () => new Date()),
  })
}

function states(workbench: Workbench) {
  const state = workbench.getState()
  return deriveStageStates(state.workflow, state.tasks)
}

function fit(workbench: Workbench, meterId = 'meter:district-2025') {
  workbench.execute({
    type: 'calibration.fit',
    input: { meterId, unit: 'kWh' },
  })
  return finishJobNow(workbench, workbench.getState().taskIds.at(-1) ?? '')
}

describe('meter series and fit metrics', () => {
  test('a fit needs twelve months of one year with every value present', () => {
    const partial = findMeter('meter:partial-2026')
    expect(meterIssues(partial!).map((issue) => issue.message)).toEqual([
      'The series has 9 months; a fit needs 12 consecutive months of one calendar year.',
      '2026-05 (May) has no value.',
    ])
    expect(meterIssues(findMeter('meter:district-2025')!)).toEqual([])
  })

  test('converts MWh to kWh only when MWh is chosen', () => {
    const series = findMeter('meter:district-2025-mwh')!
    const asMwh = meteredKwh(series, 'MWh')!
    const asKwh = meteredKwh(series, 'kWh')!
    expect(asMwh[0]).toBeCloseTo((asKwh[0] ?? 0) * 1000)
  })

  test('a perfect fit has zero CV(RMSE) and NMBE, and the factor reduces error', () => {
    expect(fitMetrics([10, 20, 30], [10, 20, 30])).toEqual({
      cvrmsePercent: 0,
      nmbePercent: 0,
    })
    const outcome = fitFactor([100, 100, 100], [120, 118, 122])
    expect(outcome.factor).toBeCloseTo(1.2, 2)
    expect(outcome.after.cvrmsePercent).toBeLessThan(
      outcome.before.cvrmsePercent,
    )
    expect(METER_SERIES.length).toBe(3)
  })
})

describe('calibration jobs and adoption', () => {
  test('a fit publishes a separate variant and leaves the working baseline alone', () => {
    const workbench = complete()
    const before = workbench.getState().results.baseline
    const executed = states(workbench)
    expect(fit(workbench).outcome.status).toBe('applied')
    const state = workbench.getState()
    const variantId = state.calibration.variantIds[0] ?? ''
    expect(state.calibration.variants[variantId]).toMatchObject({
      meterId: 'meter:district-2025',
    })
    expect(state.results.baseline).toEqual(before)
    expect(state.calibration.adoptedVariantId).toBeNull()
    // Fitting changes no stage state.
    expect(states(workbench)[S.scenarioModeling]).toBe(
      executed[S.scenarioModeling],
    )
  })

  test('adopting changes the working baseline, outdates dependents, and can be reverted', () => {
    const workbench = complete()
    fit(workbench)
    const modeled = workbench.getState().results.baseline
    const variantId = workbench.getState().calibration.variantIds[0] ?? ''
    expect(
      workbench.execute({ type: 'calibration.adopt', input: { variantId } })
        .outcome.status,
    ).toBe('applied')
    let state = workbench.getState()
    expect(state.results.baseline?.label).toBe('Calibrated baseline')
    expect(states(workbench)[S.scenarioDefinitions]).toBe('stale')
    expect(adoptBlocker(state, variantId)).toMatch(
      /already the working baseline/,
    )
    // A later fit still uses the modeled baseline.
    fit(workbench)
    state = workbench.getState()
    const second =
      state.calibration.variants[state.calibration.variantIds[1] ?? '']
    expect(second?.modeledKwh).toEqual(modeled?.monthlyKwh)

    workbench.execute({ type: 'calibration.revert', input: {} })
    state = workbench.getState()
    expect(state.results.baseline).toEqual(modeled)
    expect(state.calibration.adoptedVariantId).toBeNull()
  })

  test('a variant fitted to an older baseline cannot be adopted', () => {
    const workbench = complete()
    fit(workbench)
    const variantId = workbench.getState().calibration.variantIds[0] ?? ''
    runStageNow(workbench, S.baseline)
    expect(adoptBlocker(workbench.getState(), variantId)).toMatch(
      /changed after this fit/,
    )
  })

  test('rejects an invalid series and holds nothing from a failed fit', () => {
    const workbench = complete()
    expect(
      fitBlocker(workbench.getState(), {
        meterId: 'meter:partial-2026',
        unit: 'kWh',
      }),
    ).toMatch(/cannot be fitted/)
    expect(
      workbench.execute({
        type: 'calibration.fit',
        input: { meterId: 'meter:partial-2026', unit: 'kWh' },
      }).outcome,
    ).toMatchObject({ status: 'rejected', issues: [{ path: 'meterId' }] })

    workbench.execute({
      type: 'calibration.fit',
      input: { meterId: 'meter:district-2025', unit: 'kWh' },
    })
    const taskId = workbench.getState().taskIds.at(-1) ?? ''
    workbench.execute({ type: 'task.start', input: { taskId } }, 'system')
    workbench.execute(
      { type: 'task.fail', input: { taskId, message: 'Server error.' } },
      'system',
    )
    const state = workbench.getState()
    expect(state.calibration.variantIds).toEqual([])
    expect(state.workflow.stages[S.baseline]?.lastRun?.outcome).toBe(
      'succeeded',
    )
    expect(retryBlocker(state, taskId)).toBeNull()
  })
})
