import { describe, expect, test } from 'vitest'
import { buildFixture } from '../../server/fixtures.ts'
import { finishJobNow, runStageNow } from '../jobs/runNow.ts'
import { retryBlocker, retryScope } from '../jobs/runGroups.ts'
import { createWorkbench, type Workbench } from '../workbench.ts'
import { STAGE_IDS, deriveStageStates } from '../workflow.ts'
import {
  compareScenarios,
  compositionConflict,
  previewScenario,
} from './comparison.ts'
import { MEASURE_LIBRARY } from './library.ts'

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

function addLibrary(workbench: Workbench, libraryId: string): string {
  workbench.execute({ type: 'measure.addFromLibrary', input: { libraryId } })
  const entry = MEASURE_LIBRARY.find((item) => item.libraryId === libraryId)
  const measure = Object.values(workbench.getState().measures).find(
    (item) => item.name === entry?.name,
  )
  if (!measure) throw new Error(`Missing ${libraryId}`)
  return measure.id
}

describe('measures and scenario composition', () => {
  test('library copies keep provenance and edits are validated and undoable', () => {
    const workbench = complete()
    const id = addLibrary(workbench, 'measure:led-lighting')
    expect(workbench.getState().measures[id]?.source).toEqual({
      kind: 'library',
      libraryId: 'measure:led-lighting',
    })
    expect(
      workbench.execute({
        type: 'measure.update',
        input: {
          id,
          name: 'LED lighting',
          kind: 'pv',
          savingsPercent: 7,
          appliesTo: 'all',
        },
      }).outcome,
    ).toMatchObject({
      status: 'rejected',
      issues: [{ path: 'savingsPercent' }],
    })
    workbench.execute({
      type: 'measure.update',
      input: {
        id,
        name: 'LED lighting',
        kind: 'lighting',
        savingsPercent: 9,
        appliesTo: 'all',
      },
    })
    expect(workbench.getState().measures[id]).toMatchObject({
      savingsPercent: 9,
      source: { kind: 'project', libraryId: 'measure:led-lighting' },
    })
    workbench.undo()
    expect(workbench.getState().measures[id]?.savingsPercent).toBe(7)
  })

  test('a scenario combines at most one measure of each kind', () => {
    const workbench = complete()
    const walls = addLibrary(workbench, 'measure:wall-insulation')
    const existing = Object.keys(workbench.getState().measures)[0] ?? ''
    expect(
      compositionConflict(workbench.getState().measures, [existing, walls]),
    ).toMatch(/both envelope measures/)
    expect(
      workbench.execute({
        type: 'scenario.create',
        input: {
          name: 'Two envelopes',
          measureIds: [existing, walls],
          adoptionPercent: 50,
        },
      }).outcome,
    ).toMatchObject({ status: 'rejected', issues: [{ path: 'measureIds' }] })
    // Changing a used measure's kind into a conflict is refused too.
    const led = addLibrary(workbench, 'measure:led-lighting')
    workbench.execute({
      type: 'scenario.create',
      input: {
        name: 'Mixed',
        measureIds: [existing, led],
        adoptionPercent: 50,
      },
    })
    expect(
      workbench.execute({
        type: 'measure.update',
        input: {
          id: led,
          name: 'LED lighting',
          kind: 'envelope',
          savingsPercent: 7,
          appliesTo: 'all',
        },
      }).outcome,
    ).toMatchObject({ status: 'rejected', issues: [{ path: 'kind' }] })
  })

  test('previews affected buildings and an estimate against the baseline', () => {
    const workbench = complete()
    const heatPumps = addLibrary(workbench, 'measure:heat-pumps')
    const state = workbench.getState()
    const preview = previewScenario(state, {
      measureIds: [heatPumps],
      adoptionPercent: 100,
    })
    const residential = Object.keys(
      state.results.baseline?.byBuildingKwh ?? {},
    ).filter((id) => state.buildings[id]?.use === 'residential').length
    expect(preview).toMatchObject({ available: true, affected: residential })
    expect(preview.reductionPercent).toBeGreaterThan(0)
  })
})

describe('scenario modeling as a comparison set', () => {
  test('models included scenarios as items and publishes them together', () => {
    const workbench = complete()
    const led = addLibrary(workbench, 'measure:led-lighting')
    workbench.execute({
      type: 'scenario.create',
      input: { name: 'Lighting only', measureIds: [led], adoptionPercent: 80 },
    })
    const lighting = Object.values(workbench.getState().scenarios).find(
      (scenario) => scenario.name === 'Lighting only',
    )
    expect(states(workbench)[S.scenarioDefinitions]).toBe('stale')
    runStageNow(workbench, S.scenarioDefinitions)
    workbench.execute({
      type: 'workflow.runStage',
      input: { stageId: S.scenarioModeling },
    })
    const taskId = workbench.getState().taskIds.at(-1) ?? ''
    expect(workbench.getState().tasks[taskId]?.items?.ids).toHaveLength(2)
    const before = workbench.getState().results.scenarios
    finishJobNow(workbench, taskId, {
      failures: { [lighting?.id ?? '']: 'Fault.' },
    })
    // The earlier set stays published while the new one is held.
    expect(workbench.getState().results.scenarios).toEqual(before)
    const group =
      workbench.getState().runGroups[
        workbench.getState().tasks[taskId]?.groupId ?? ''
      ]
    expect(retryScope(group!)).toBe('Retry 1 failed scenario')
    expect(retryBlocker(workbench.getState(), taskId)).toBeNull()
    workbench.execute({ type: 'job.retry', input: { taskId } })
    finishJobNow(workbench, workbench.getState().taskIds.at(-1) ?? '')
    const results = workbench.getState().results.scenarios
    expect(Object.keys(results)).toHaveLength(2)
    const runIds = new Set(Object.values(results).map((result) => result.runId))
    expect(runIds.size).toBe(1)
    const rows = compareScenarios(
      workbench.getState(),
      states(workbench),
      S.scenarioModeling,
      S.baseline,
    )
    expect(rows.map((row) => row.name)).toEqual([
      'Baseline',
      'Envelope retrofit',
      'Lighting only',
    ])
  })

  test('leaving a scenario out of the comparison withdraws its result on the next run', () => {
    const workbench = complete()
    const scenario = Object.values(workbench.getState().scenarios)[0]
    if (!scenario) throw new Error('Missing scenario')
    workbench.execute({
      type: 'scenario.update',
      input: { ...scenario, included: false },
    })
    expect(
      workbench.execute({
        type: 'workflow.runStage',
        input: { stageId: S.scenarioDefinitions },
      }).outcome.status,
    ).toBe('applied')
    finishJobNow(workbench, workbench.getState().taskIds.at(-1) ?? '')
    expect(states(workbench)[S.scenarioDefinitions]).toBe('failed')
    workbench.execute({
      type: 'scenario.update',
      input: { ...scenario, included: true, adoptionPercent: 20 },
    })
    runStageNow(workbench, S.scenarioDefinitions)
    runStageNow(workbench, S.scenarioModeling)
    expect(
      workbench.getState().results.scenarios[scenario.id]?.totalKwh,
    ).toBeGreaterThan(0)
  })
})
