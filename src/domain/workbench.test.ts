import { describe, expect, test } from 'vitest'
import { GROUP } from './assets.ts'
import { capabilities } from './capabilities.ts'
import { describeCommands } from './commands.ts'
import { finishJobNow } from './jobs/runNow.ts'
import { computeScenarioResult } from './simulation.ts'
import type { Building } from './types.ts'
import { createWorkbench, type Workbench } from './workbench.ts'
import { STAGE_IDS, deriveStageStates, topologicalOrder } from './workflow.ts'

const S = STAGE_IDS

function setup(): Workbench {
  return createWorkbench({ now: () => new Date('2026-09-14T12:00:00.000Z') })
}

function states(workbench: Workbench) {
  const state = workbench.getState()
  return deriveStageStates(state.workflow, state.tasks)
}

function building(workbench: Workbench, id: string): Building {
  const record = workbench.getState().buildings[id]
  if (!record) throw new Error(`Missing building ${id}`)
  return record
}

function runStage(workbench: Workbench, stageId: string) {
  const queued = workbench.execute({
    type: 'workflow.runStage',
    input: { stageId },
  })
  if (queued.outcome.status !== 'applied') {
    throw new Error(
      `Could not queue ${stageId}: ${JSON.stringify(queued.outcome)}`,
    )
  }
  const taskId = workbench.getState().taskIds.at(-1)
  if (!taskId) throw new Error('No task was queued')
  return finishJobNow(workbench, taskId)
}

function runStages(workbench: Workbench, stageIds: string[]) {
  for (const stageId of stageIds) runStage(workbench, stageId)
}

function createEnvelopeScenario(workbench: Workbench) {
  expect(
    workbench.execute({
      type: 'measure.create',
      input: {
        name: 'Envelope retrofit',
        kind: 'envelope',
        savingsPercent: 25,
        appliesTo: 'residential',
      },
    }).outcome.status,
  ).toBe('applied')
  const measureId = Object.keys(workbench.getState().measures)[0]
  if (!measureId) throw new Error('Measure was not created')
  expect(
    workbench.execute({
      type: 'scenario.create',
      input: {
        name: 'Half of homes retrofitted',
        measureIds: [measureId],
        adoptionPercent: 50,
      },
    }).outcome.status,
  ).toBe('applied')
  return measureId
}

describe('workbench commands', () => {
  test('starts with the first stage ready and the full asset skeleton', () => {
    const workbench = setup()
    const derived = states(workbench)
    expect(derived[S.location]).toBe('ready')
    expect(derived[S.enrichment]).toBe('future')

    const state = workbench.getState()
    expect(state.rootAssetIds.map((id) => state.assets[id]?.name)).toEqual([
      'Energy model',
      'Grid model',
      'Data',
      'View',
    ])
    expect(state.assets[GROUP.gasNetwork]?.capability).toBe('grid.gasNetwork')
    expect(capabilities['grid.gasNetwork'].status).toBe('planned')
  })

  test('rejects invalid input without changing state and records the rejection', () => {
    const workbench = setup()
    const before = workbench.getState()
    const result = workbench.execute({
      type: 'workflow.runStage',
      input: { stageId: '' },
    })

    expect(result.outcome).toEqual({
      status: 'rejected',
      issues: [{ path: 'stageId', message: 'Choose a stage.' }],
    })
    expect(workbench.getState()).toBe(before)
    expect(workbench.store.getState().log.at(-1)).toMatchObject({
      id: result.operationId,
      status: 'rejected',
      source: 'manual',
    })
  })

  test('refuses to run a stage before its prerequisites', () => {
    const workbench = setup()
    const result = workbench.execute({
      type: 'workflow.runStage',
      input: { stageId: S.enrichment },
    })
    expect(result.outcome.status).toBe('rejected')
    expect(JSON.stringify(result.outcome)).toContain(
      'Complete or skip earlier stages first',
    )
  })

  test('runs a stage as a background task and records stage provenance on outputs', () => {
    const workbench = setup()
    workbench.execute({
      type: 'workflow.runStage',
      input: { stageId: S.location },
    })
    const taskId = workbench.getState().taskIds[0] ?? ''
    expect(workbench.getState().tasks[taskId]?.status).toBe('queued')
    expect(states(workbench)[S.location]).toBe('running')
    expect(
      workbench.execute({
        type: 'workflow.runStage',
        input: { stageId: S.location },
      }).outcome.status,
    ).toBe('rejected')

    workbench.execute({ type: 'task.start', input: { taskId } }, 'system')
    const completed = workbench.execute(
      { type: 'task.complete', input: { taskId } },
      'system',
    )

    expect(completed.outcome.status).toBe('applied')
    expect(states(workbench)[S.location]).toBe('executed')
    expect(states(workbench)[S.enrichment]).toBe('ready')
    const state = workbench.getState()
    expect(state.buildingIds).toHaveLength(464)
    expect(state.assets['asset:footprints']?.provenance).toEqual({
      kind: 'stage',
      stageId: S.location,
      runId: state.tasks[taskId]?.runId,
      operationId: completed.operationId,
    })
    expect(state.tasks[taskId]).toMatchObject({
      status: 'succeeded',
      progress: 1,
    })
  })

  test('cancels a queued task and leaves the stage runnable', () => {
    const workbench = setup()
    workbench.execute({
      type: 'workflow.runStage',
      input: { stageId: S.location },
    })
    const taskId = workbench.getState().taskIds[0] ?? ''

    expect(
      workbench.execute({ type: 'task.cancel', input: { taskId } }).outcome
        .status,
    ).toBe('applied')
    expect(workbench.getState().tasks[taskId]?.status).toBe('cancelled')
    expect(states(workbench)[S.location]).toBe('ready')
    expect(
      workbench.execute({ type: 'task.complete', input: { taskId } }, 'system')
        .outcome.status,
    ).toBe('rejected')
  })

  test('skips optional stages but refuses to skip required ones', () => {
    const workbench = setup()
    expect(
      workbench.execute({
        type: 'workflow.setStageSkipped',
        input: { stageId: S.location, skipped: true },
      }).outcome.status,
    ).toBe('rejected')

    runStages(workbench, [S.location, S.enrichment, S.schema, S.preprocessing])
    expect(
      workbench.execute({
        type: 'workflow.setStageSkipped',
        input: { stageId: S.shading, skipped: true },
      }).outcome.status,
    ).toBe('applied')
    expect(states(workbench)[S.shading]).toBe('skipped')
    expect(states(workbench)[S.archetypes]).toBe('ready')
  })

  test('holds validated edits as pending, applies them as overrides, and undoes them', () => {
    const workbench = setup()
    runStages(workbench, [
      S.location,
      S.enrichment,
      S.schema,
      S.preprocessing,
      S.shading,
      S.archetypes,
    ])
    const original = building(workbench, 'B0001').floors ?? 1
    const edited = original + 1

    const invalid = workbench.execute({
      type: 'edits.propose',
      input: { entityId: 'B0001', field: 'floors', value: 0 },
    })
    expect(invalid.outcome).toEqual({
      status: 'rejected',
      issues: [
        {
          path: 'value',
          message: 'Floors must be a whole number from 1 to 60.',
        },
      ],
    })

    workbench.execute({
      type: 'edits.propose',
      input: { entityId: 'B0001', field: 'floors', value: edited },
    })
    expect(Object.values(workbench.getState().pendingEdits)).toEqual([
      { entityId: 'B0001', field: 'floors', from: original, to: edited },
    ])
    expect(building(workbench, 'B0001').floors).toBe(original)

    workbench.execute({ type: 'edits.apply', input: {} })
    expect(building(workbench, 'B0001').floors).toBe(edited)
    expect(states(workbench)).toMatchObject({
      [S.enrichment]: 'executed',
      [S.schema]: 'stale',
      [S.archetypes]: 'stale',
    })

    workbench.undo()
    expect(building(workbench, 'B0001').floors).toBe(original)
    expect(states(workbench)[S.schema]).toBe('executed')
    expect(workbench.getState().overrides).toEqual({})

    workbench.redo()
    expect(building(workbench, 'B0001').floors).toBe(edited)
    expect(states(workbench)[S.schema]).toBe('stale')

    const rerun = runStage(workbench, S.enrichment)
    expect(rerun.outcome.status).toBe('applied')
    expect(building(workbench, 'B0001').floors).toBe(edited)
    expect(
      workbench
        .getState()
        .issues.some((issue) =>
          issue.message.includes('manual floor override'),
        ),
    ).toBe(true)
  })

  test('fails scenario definitions without scenarios and validates creators', () => {
    const workbench = setup()
    runStages(workbench, [S.location, S.enrichment, S.schema, S.preprocessing])
    workbench.execute({
      type: 'workflow.setStageSkipped',
      input: { stageId: S.shading, skipped: true },
    })
    runStages(workbench, [S.archetypes, S.baseline])

    runStage(workbench, S.scenarioDefinitions)
    expect(states(workbench)[S.scenarioDefinitions]).toBe('failed')
    expect(states(workbench)[S.scenarioModeling]).toBe('blocked')
    expect(workbench.getState().issues).toContainEqual(
      expect.objectContaining({
        severity: 'error',
        stageId: S.scenarioDefinitions,
      }),
    )

    const tooMuch = workbench.execute({
      type: 'measure.create',
      input: {
        name: 'Deep retrofit',
        kind: 'envelope',
        savingsPercent: 80,
        appliesTo: 'all',
      },
    })
    expect(tooMuch.outcome).toMatchObject({
      status: 'rejected',
      issues: [{ path: 'savingsPercent' }],
    })
    expect(
      workbench.execute({
        type: 'measure.create',
        input: {
          name: 'Rooftop PV',
          kind: 'pv',
          savingsPercent: 10,
          appliesTo: 'all',
        },
      }).outcome.status,
    ).toBe('rejected')

    const measureId = createEnvelopeScenario(workbench)
    expect(
      workbench.execute({
        type: 'measure.create',
        input: {
          name: '  envelope RETROFIT ',
          kind: 'heating',
          savingsPercent: 10,
          appliesTo: 'all',
        },
      }).outcome,
    ).toMatchObject({ status: 'rejected', issues: [{ path: 'name' }] })
    expect(
      workbench.execute({
        type: 'scenario.create',
        input: {
          name: 'Unknown',
          measureIds: ['measure-999'],
          adoptionPercent: 20,
        },
      }).outcome,
    ).toMatchObject({ status: 'rejected', issues: [{ path: 'measureIds' }] })

    const scenario = Object.values(workbench.getState().scenarios)[0]
    expect(scenario?.measureIds).toEqual([measureId])
    const scenarioAsset =
      workbench.getState().assets[`asset:${scenario?.id ?? ''}`]
    expect(scenarioAsset).toMatchObject({
      parentId: GROUP.scenarios,
      provenance: { kind: 'operation', source: 'manual' },
    })

    runStage(workbench, S.scenarioDefinitions)
    expect(states(workbench)[S.scenarioDefinitions]).toBe('executed')
    runStage(workbench, S.scenarioModeling)
    const { baseline, scenarios } = workbench.getState().results
    const scenarioResult = Object.values(scenarios)[0]
    expect(scenarioResult?.totalKwh).toBeLessThan(baseline?.totalKwh ?? 0)

    workbench.execute({
      type: 'measure.create',
      input: {
        name: 'LED lighting',
        kind: 'lighting',
        savingsPercent: 8,
        appliesTo: 'all',
      },
    })
    expect(states(workbench)).toMatchObject({
      [S.scenarioDefinitions]: 'stale',
      [S.scenarioModeling]: 'stale',
    })
  })

  test('records a scripted grid solver failure and recovers on retry', () => {
    const workbench = setup()
    runStages(workbench, [S.location, S.enrichment, S.schema, S.preprocessing])
    workbench.execute({
      type: 'workflow.setStageSkipped',
      input: { stageId: S.shading, skipped: true },
    })
    runStages(workbench, [S.archetypes, S.baseline])
    createEnvelopeScenario(workbench)
    runStages(workbench, [
      S.scenarioDefinitions,
      S.scenarioModeling,
      S.gridDefinitions,
    ])

    runStage(workbench, S.gridModeling)
    const failedStage = workbench.getState().workflow.stages[S.gridModeling]
    expect(states(workbench)[S.gridModeling]).toBe('failed')
    expect(failedStage?.lastRun?.message).toContain('did not converge')
    expect(states(workbench)[S.dashboard]).toBe('blocked')

    runStage(workbench, S.gridModeling)
    expect(states(workbench)[S.gridModeling]).toBe('executed')
    expect(
      Object.keys(
        workbench.getState().gridResult?.transformerLoadingPercent ?? {},
      ),
    ).toEqual(['T1', 'T2', 'T3', 'T4'])

    runStage(workbench, S.dashboard)
    expect(states(workbench)[S.dashboard]).toBe('executed')
    const report = workbench.getState().assets['asset:report-summary']
    expect(report?.capability).toBe('reports.export')
    expect(capabilities['reports.export'].status).toBe('planned')
  })

  test('inserts a custom stage without creating cycles and undoes the insertion', () => {
    const workbench = setup()
    expect(
      workbench.execute({
        type: 'workflow.insertStage',
        input: { afterStageId: S.schema, name: ' ' },
      }).outcome,
    ).toMatchObject({ status: 'rejected', issues: [{ path: 'name' }] })

    workbench.execute({
      type: 'workflow.insertStage',
      input: { afterStageId: S.schema, name: 'Data quality review' },
    })
    const { workflow } = workbench.getState()
    const customId = workflow.stageIds.find((id) => workflow.stages[id]?.custom)
    expect(customId).toBeDefined()
    expect(workflow.stageIds.indexOf(customId ?? '')).toBe(
      workflow.stageIds.indexOf(S.schema) + 1,
    )
    expect(workflow.edges).toContainEqual({ from: S.schema, to: customId })
    expect(workflow.edges).toContainEqual({
      from: customId,
      to: S.preprocessing,
    })
    expect(workflow.edges).not.toContainEqual({
      from: S.schema,
      to: S.preprocessing,
    })
    expect(topologicalOrder(workflow.stageIds, workflow.edges)).not.toBeNull()

    workbench.undo()
    const restored = workbench.getState().workflow
    expect(restored.stageIds).toHaveLength(12)
    expect(restored.edges).toContainEqual({
      from: S.schema,
      to: S.preprocessing,
    })
  })

  test('validates selection ids and keeps an empty selection explicit', () => {
    const workbench = setup()
    expect(
      workbench.execute({
        type: 'selection.set',
        input: { entityType: 'building', ids: ['B0001'] },
      }).outcome.status,
    ).toBe('rejected')

    runStage(workbench, S.location)
    workbench.execute({
      type: 'selection.set',
      input: { entityType: 'building', ids: ['B0001', 'B0002', 'B0001'] },
    })
    expect(workbench.getState().selection).toEqual({
      entityType: 'building',
      ids: ['B0001', 'B0002'],
    })

    workbench.execute({ type: 'selection.clear', input: {} })
    expect(workbench.getState().selection).toEqual({
      entityType: null,
      ids: [],
    })
  })

  test('describes every command with a JSON Schema input for agent tools', () => {
    const catalog = describeCommands()
    const runStageEntry = catalog.find(
      (entry) => entry.type === 'workflow.runStage',
    )
    expect(runStageEntry).toMatchObject({
      title: 'Run stage',
      undoable: false,
      inputSchema: {
        type: 'object',
        properties: { stageId: { type: 'string' } },
      },
    })
    expect(catalog.length).toBeGreaterThanOrEqual(15)
  })
})

describe('external operations', () => {
  test('records layout and blocked actions in the same operation log', () => {
    const workbench = setup()
    const operationId = workbench.record({
      type: 'layout.openPage',
      title: 'Open page',
      input: { page: 'table' },
      summary: 'Opened the Table page.',
    })
    expect(workbench.store.getState().log.at(-1)).toMatchObject({
      id: operationId,
      type: 'layout.openPage',
      status: 'applied',
      source: 'manual',
      undoable: false,
    })

    workbench.record({
      type: 'action.help.comments',
      title: 'Comments',
      summary: '',
      status: 'rejected',
      issues: [{ path: '', message: 'Planned: comments.' }],
    })
    expect(workbench.store.getState().log.at(-1)).toMatchObject({
      status: 'rejected',
      summary: null,
      issues: [{ message: 'Planned: comments.' }],
    })
  })

  test('loads replacement state and clears undo history', () => {
    const workbench = setup()
    workbench.execute({
      type: 'workflow.insertStage',
      input: { afterStageId: S.schema, name: 'Review' },
    })
    expect(workbench.store.getState().canUndo).toBe(true)

    const replacement = createWorkbench().getState()
    workbench.load(replacement, {
      type: 'project.reset',
      title: 'New project',
      summary: 'Started a new empty project.',
    })
    expect(workbench.getState()).toBe(replacement)
    expect(workbench.store.getState().canUndo).toBe(false)
    expect(workbench.undo().outcome.status).toBe('rejected')
  })
})

describe('scenario adoption', () => {
  function modelOneScenario(workbench: Workbench) {
    runStages(workbench, [S.location, S.enrichment, S.schema, S.preprocessing])
    workbench.execute({
      type: 'workflow.setStageSkipped',
      input: { stageId: S.shading, skipped: true },
    })
    runStages(workbench, [S.archetypes, S.baseline])
    createEnvelopeScenario(workbench)
    runStages(workbench, [S.scenarioDefinitions, S.scenarioModeling])
    const scenario = Object.values(workbench.getState().scenarios)[0]
    if (!scenario) throw new Error('Scenario was not created')
    return scenario
  }

  test('previews use the same calculation as scenario modeling', () => {
    const workbench = setup()
    const scenario = modelOneScenario(workbench)
    const state = workbench.getState()
    const modeled = state.results.scenarios[scenario.id]
    const preview = computeScenarioResult(state, scenario, { runId: 'preview' })
    expect(preview?.totalKwh).toBe(modeled?.totalKwh)

    const higher = computeScenarioResult(state, scenario, {
      runId: 'preview',
      adoptionPercent: 100,
    })
    expect(higher?.totalKwh).toBeLessThan(modeled?.totalKwh ?? 0)
  })

  test('setting adoption validates input, marks scenario stages stale, and undoes', () => {
    const workbench = setup()
    const scenario = modelOneScenario(workbench)

    expect(
      workbench.execute({
        type: 'scenario.setAdoption',
        input: { scenarioId: 'scenario-999', adoptionPercent: 60 },
      }).outcome,
    ).toMatchObject({ status: 'rejected', issues: [{ path: 'scenarioId' }] })
    expect(
      workbench.execute({
        type: 'scenario.setAdoption',
        input: {
          scenarioId: scenario.id,
          adoptionPercent: scenario.adoptionPercent,
        },
      }).outcome,
    ).toMatchObject({
      status: 'rejected',
      issues: [{ path: 'adoptionPercent' }],
    })

    workbench.execute({
      type: 'scenario.setAdoption',
      input: { scenarioId: scenario.id, adoptionPercent: 80 },
    })
    expect(workbench.getState().scenarios[scenario.id]?.adoptionPercent).toBe(
      80,
    )
    expect(states(workbench)).toMatchObject({
      [S.scenarioDefinitions]: 'stale',
      [S.scenarioModeling]: 'stale',
    })

    workbench.undo()
    expect(workbench.getState().scenarios[scenario.id]?.adoptionPercent).toBe(
      scenario.adoptionPercent,
    )
    expect(states(workbench)[S.scenarioModeling]).toBe('executed')
  })
})
