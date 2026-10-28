import { describe, expect, test } from 'vitest'
import { buildFixture } from '../../server/fixtures.ts'
import { finishJobNow, runStageNow } from '../jobs/runNow.ts'
import { retryBlocker, retryScope } from '../jobs/runGroups.ts'
import { createWorkbench, type Workbench } from '../workbench.ts'
import { STAGE_IDS, deriveStageStates } from '../workflow.ts'
import type { Building, Measure, ScenarioRule } from '../types.ts'
import { compareScenarios } from './comparison.ts'
import { MEASURE_LIBRARY } from './library.ts'
import { usesPvWithoutYield } from '../simulation.ts'
import {
  adoptionUnit,
  aggregateScenario,
  baselineChangeNote,
  scenarioBaseline,
  alternativeKwh,
  assignMeasures,
  isAdopted,
  prepareScenarioRules,
  previewScenarioRules,
  scenarioRules,
} from './rules.ts'

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

function firstScenario(workbench: Workbench) {
  const scenario = Object.values(workbench.getState().scenarios)[0]
  if (!scenario) throw new Error('Missing scenario')
  return scenario
}

const none = { envelope: null, heating: null, lighting: null, pv: null }

describe('measures', () => {
  test('library copies keep provenance and edits are validated and undoable', () => {
    const workbench = complete()
    const id = addLibrary(workbench, 'measure:led-lighting')
    expect(workbench.getState().measures[id]).toMatchObject({
      source: { kind: 'library', libraryId: 'measure:led-lighting' },
    })
    expect(workbench.getState().measures[id]).not.toHaveProperty('appliesTo')
    expect(
      workbench.execute({
        type: 'measure.update',
        input: { id, name: 'LED lighting', kind: 'pv', savingsPercent: 7 },
      }).outcome,
    ).toMatchObject({
      status: 'rejected',
      issues: [{ path: 'savingsPercent' }],
    })
    workbench.execute({
      type: 'measure.update',
      input: { id, name: 'LED lighting', kind: 'lighting', savingsPercent: 9 },
    })
    expect(workbench.getState().measures[id]).toMatchObject({
      savingsPercent: 9,
      source: { kind: 'project', libraryId: 'measure:led-lighting' },
    })
    workbench.undo()
    expect(workbench.getState().measures[id]?.savingsPercent).toBe(7)
  })

  test('a measure a rule assigns keeps its category', () => {
    const workbench = complete()
    const envelope = Object.keys(workbench.getState().measures)[0] ?? ''
    expect(
      workbench.execute({
        type: 'measure.update',
        input: {
          id: envelope,
          name: 'Envelope retrofit',
          kind: 'lighting',
          savingsPercent: 20,
        },
      }).outcome,
    ).toMatchObject({ status: 'rejected', issues: [{ path: 'kind' }] })
  })
})

describe('scenario rules', () => {
  test('a first rule from measureIds takes at most one measure per category', () => {
    const workbench = complete()
    const walls = addLibrary(workbench, 'measure:wall-insulation')
    const existing = Object.keys(workbench.getState().measures)[0] ?? ''
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
    workbench.execute({
      type: 'scenario.create',
      input: { name: 'Empty', adoptionPercent: 30 },
    })
    const empty = Object.values(workbench.getState().scenarios).find(
      (scenario) => scenario.name === 'Empty',
    )
    expect(empty).toMatchObject({ ruleIds: [], adoptionSeed: 42 })
  })

  test('validates rules per field and keeps names unique in a scenario', () => {
    const workbench = complete()
    const scenario = firstScenario(workbench)
    const envelope = Object.keys(workbench.getState().measures)[0] ?? ''
    const outcome = workbench.execute({
      type: 'scenarioRule.save',
      input: {
        scenarioId: scenario.id,
        name: 'All buildings',
        logic: 'all',
        conditions: [{ field: 'floors', operator: 'contains', value: 'x' }],
        measures: { ...none, heating: envelope },
      },
    }).outcome
    expect(outcome.status).toBe('rejected')
    const paths =
      outcome.status === 'rejected'
        ? outcome.issues.map((issue) => issue.path)
        : []
    expect(paths).toEqual(['name'])
    const fields = workbench.execute({
      type: 'scenarioRule.save',
      input: {
        scenarioId: scenario.id,
        name: 'Tall',
        logic: 'all',
        conditions: [{ field: 'floors', operator: 'contains', value: 'x' }],
        measures: { ...none, heating: envelope },
      },
    }).outcome
    expect(
      fields.status === 'rejected'
        ? fields.issues.map((issue) => issue.path)
        : [],
    ).toEqual(['conditions.0.operator', 'measures.heating'])
    expect(
      workbench.execute({
        type: 'scenarioRule.save',
        input: {
          scenarioId: scenario.id,
          name: 'Nothing',
          logic: 'all',
          conditions: [],
          measures: none,
        },
      }).outcome,
    ).toMatchObject({ status: 'rejected', issues: [{ path: 'measures' }] })
  })

  test('each category takes the first enabled matching rule that sets it', () => {
    const workbench = complete()
    const scenario = firstScenario(workbench)
    const envelope = Object.keys(workbench.getState().measures)[0] ?? ''
    const walls = addLibrary(workbench, 'measure:wall-insulation')
    const pumps = addLibrary(workbench, 'measure:heat-pumps')
    // Above "All buildings": residential buildings take heat pumps and other walls.
    workbench.execute({
      type: 'scenarioRule.save',
      input: {
        scenarioId: scenario.id,
        name: 'Homes',
        logic: 'all',
        conditions: [
          { field: 'use', operator: 'equals', value: 'residential' },
        ],
        measures: { ...none, envelope: walls, heating: pumps },
      },
    })
    const state = workbench.getState()
    const current = state.scenarios[scenario.id]!
    const rules = scenarioRules(state, current)
    expect(rules.map((rule) => rule.name)).toEqual(['Homes', 'All buildings'])
    const { prepared } = prepareScenarioRules(state, rules)
    const home = Object.values(state.buildings).find(
      (building) => building.use === 'residential',
    ) as Building
    const office = Object.values(state.buildings).find(
      (building) => building.use === 'office',
    ) as Building
    expect(assignMeasures(prepared, home).measures).toMatchObject({
      envelope: { measureId: walls, ruleName: 'Homes' },
      heating: { measureId: pumps, ruleName: 'Homes' },
      lighting: null,
    })
    expect(assignMeasures(prepared, office).measures).toMatchObject({
      envelope: { measureId: envelope, ruleName: 'All buildings' },
      heating: null,
    })
    // Switched off, "Homes" is skipped and every building takes the first rule below.
    workbench.execute({
      type: 'scenarioRule.setEnabled',
      input: { ruleId: rules[0]!.id, enabled: false },
    })
    const off = workbench.getState()
    const offRules = scenarioRules(off, off.scenarios[scenario.id]!)
    expect(
      assignMeasures(prepareScenarioRules(off, offRules).prepared, home)
        .measures,
    ).toMatchObject({
      envelope: { measureId: envelope },
      heating: null,
    })
    // Moving, duplicating, and removing are undoable commands.
    workbench.execute({
      type: 'scenarioRule.move',
      input: { ruleId: rules[0]!.id, position: 1 },
    })
    workbench.execute({
      type: 'scenarioRule.duplicate',
      input: { ruleId: rules[0]!.id },
    })
    expect(
      scenarioRules(
        workbench.getState(),
        workbench.getState().scenarios[scenario.id]!,
      ).map((rule) => rule.name),
    ).toEqual(['All buildings', 'Homes', 'Homes (copy)'])
    workbench.undo()
    workbench.undo()
    workbench.undo()
    workbench.undo()
    expect(workbench.getState().scenarios[scenario.id]?.ruleIds).toEqual(
      scenario.ruleIds,
    )
    // Undoing the two library copies too leaves the published set current.
    workbench.undo()
    workbench.undo()
    expect(states(workbench)[S.scenarioModeling]).toBe('executed')
  })

  test('previews per rule, the affected buildings, and an estimate', () => {
    const workbench = complete()
    const pumps = addLibrary(workbench, 'measure:heat-pumps')
    const state = workbench.getState()
    const rule: ScenarioRule = {
      id: 'draft',
      scenarioId: 'draft',
      name: 'Homes',
      enabled: true,
      logic: 'all',
      conditions: [{ field: 'use', operator: 'equals', value: 'residential' }],
      measures: { ...none, heating: pumps },
    }
    const preview = previewScenarioRules(state, {
      rules: [rule],
      adoptionPercent: 100,
      adoptionSeed: 42,
    })
    const residential = Object.keys(
      state.results.baseline?.byBuildingKwh ?? {},
    ).filter((id) => state.buildings[id]?.use === 'residential')
    expect(preview.rules[0]).toMatchObject({
      matched: residential.length,
      takes: { heating: residential.length, envelope: 0 },
    })
    expect(preview.affectedIds).toEqual(residential)
    expect(preview.adoptedIds).toHaveLength(residential.length)
    expect(preview.estimate?.reductionPercent).toBeGreaterThan(0)
    expect(preview.changes).toBeNull()
    // Before baseline results there are counts but no estimate.
    const early = previewScenarioRules(
      { ...state, results: { ...state.results, baseline: null } },
      { rules: [rule], adoptionPercent: 50, adoptionSeed: 42 },
    )
    expect(early.estimate).toBeNull()
    expect(early.reason).toMatch(/baseline results/)
    expect(early.buildings).toBe(state.buildingIds.length)
    // A rule that matches nothing and one with only blank conditions.
    const blank = previewScenarioRules(state, {
      rules: [
        {
          ...rule,
          id: 'r1',
          conditions: [{ field: null, operator: 'equals', value: '' }],
        },
        {
          ...rule,
          id: 'r2',
          name: 'Nobody',
          conditions: [{ field: 'floors', operator: 'larger', value: '999' }],
        },
      ],
      adoptionPercent: 50,
      adoptionSeed: 42,
    })
    expect(blank.warnings.map((warning) => warning.code)).toEqual([
      'blank_conditions_skipped',
    ])
    expect(blank.affectedIds).toEqual([])
    expect(blank.rules[1]?.matched).toBe(0)
  })
})

describe('adoption sampling', () => {
  const ids = Array.from({ length: 20_000 }, (_, index) => `B${index}`)

  test('is deterministic per seed and building', () => {
    expect(adoptionUnit(42, 'B0001')).toBe(adoptionUnit(42, 'B0001'))
    expect(adoptionUnit(42, 'B0001')).not.toBe(adoptionUnit(43, 'B0001'))
    for (const id of ids.slice(0, 200)) {
      const unit = adoptionUnit(7, id)
      expect(unit).toBeGreaterThanOrEqual(0)
      expect(unit).toBeLessThan(1)
    }
    const a = ids.filter((id) => isAdopted(42, id, 30))
    const b = ids.filter((id) => isAdopted(43, id, 30))
    expect(a).not.toEqual(b)
  })

  test('adopts close to the fraction, and more adoption only adds buildings', () => {
    for (const percent of [10, 25, 50, 75, 90]) {
      const share =
        ids.filter((id) => isAdopted(42, id, percent)).length / ids.length
      expect(Math.abs(share - percent / 100)).toBeLessThan(0.015)
    }
    expect(ids.filter((id) => isAdopted(42, id, 0))).toEqual([])
    expect(ids.every((id) => isAdopted(42, id, 100))).toBe(true)
    const low = ids.filter((id) => isAdopted(42, id, 30))
    const high = new Set(ids.filter((id) => isAdopted(42, id, 60)))
    expect(low.every((id) => high.has(id))).toBe(true)
  })

  test('aggregates adopted buildings at their alternative and the rest at baseline', () => {
    const versions = {
      runId: 'run-1',
      baselineRunId: 'run-0',
      baseKwh: { A: 100, B: 200, C: 300 },
      alternativeKwh: { A: 50, B: 100 },
      measures: {},
    }
    const scenario = {
      id: 's',
      name: 'S',
      adoptionPercent: 100,
      adoptionSeed: 42,
    }
    const full = aggregateScenario(scenario, versions)
    expect(full.result.byBuildingKwh).toEqual({ A: 50, B: 100, C: 300 })
    expect(full.result.totalKwh).toBe(450)
    expect(full).toMatchObject({ eligible: 2, adoptedIds: ['A', 'B'] })
    const zero = aggregateScenario(scenario, versions, 0)
    expect(zero.result.totalKwh).toBe(600)
    expect(zero.adoptedIds).toEqual([])
    const half = aggregateScenario(scenario, versions, 50)
    for (const id of ['A', 'B']) {
      expect(half.result.byBuildingKwh[id]).toBe(
        isAdopted(42, id, 50)
          ? versions.alternativeKwh[id as 'A' | 'B']
          : versions.baseKwh[id as 'A' | 'B'],
      )
    }
    expect(half.result.runId).toBe('run-1')
  })

  test('the alternative version adds savings up to 60% and subtracts PV yield', () => {
    const measure = (kind: Measure['kind'], savingsPercent: number) =>
      ({
        id: kind,
        name: kind,
        kind,
        savingsPercent,
        source: { kind: 'project', operationId: 'op' },
      }) satisfies Measure
    expect(alternativeKwh(1000, undefined, [measure('envelope', 20)])).toBe(800)
    expect(
      alternativeKwh(1000, undefined, [
        measure('envelope', 50),
        measure('heating', 50),
      ]),
    ).toBe(400)
    expect(alternativeKwh(1000, { pvYieldKwh: 300 }, [measure('pv', 0)])).toBe(
      700,
    )
    expect(alternativeKwh(100, { pvYieldKwh: 300 }, [measure('pv', 0)])).toBe(0)
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
    const { scenarios: results, scenarioVersions } =
      workbench.getState().results
    expect(Object.keys(results)).toHaveLength(2)
    expect(Object.keys(scenarioVersions)).toEqual(Object.keys(results))
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
    expect(rows[2]?.adoption).toMatch(/^80% adoption, seed 42: \d+ of \d+/)
  })

  test('adoption and seed re-aggregate published versions without a new run', () => {
    const workbench = complete()
    const scenario = firstScenario(workbench)
    const state = workbench.getState()
    const versions = state.results.scenarioVersions[scenario.id]
    if (!versions) throw new Error('No versions were published')
    expect(state.results.scenarios[scenario.id]).toEqual(
      aggregateScenario(scenario, versions).result,
    )
    workbench.execute({
      type: 'scenario.update',
      input: {
        id: scenario.id,
        name: scenario.name,
        adoptionPercent: 90,
        adoptionSeed: 7,
        included: true,
      },
    })
    const after = workbench.getState()
    expect(after.results.scenarios[scenario.id]).toEqual(
      aggregateScenario(
        { ...scenario, adoptionPercent: 90, adoptionSeed: 7 },
        versions,
      ).result,
    )
    expect(after.results.scenarioVersions[scenario.id]).toEqual(versions)
    expect(states(workbench)[S.scenarioModeling]).toBe('executed')
    expect(after.assets[`asset:result-${scenario.id}`]?.summary).toMatch(
      /90% adoption, seed 7/,
    )
    // A seed that is not a whole number is refused on its field.
    expect(
      workbench.execute({
        type: 'scenario.update',
        input: {
          id: scenario.id,
          name: scenario.name,
          adoptionPercent: 90,
          adoptionSeed: 1.5,
          included: true,
        },
      }).outcome,
    ).toMatchObject({ status: 'rejected', issues: [{ path: 'adoptionSeed' }] })
    // A new name is a definition change: it outdates the scenario stages.
    workbench.execute({
      type: 'scenario.update',
      input: {
        id: scenario.id,
        name: 'Renamed',
        adoptionPercent: 90,
        adoptionSeed: 7,
        included: true,
      },
    })
    expect(states(workbench)[S.scenarioModeling]).toBe('stale')
  })

  test('the published measures say which rule gave each building its measure', () => {
    const workbench = complete()
    const scenario = firstScenario(workbench)
    const state = workbench.getState()
    const versions = state.results.scenarioVersions[scenario.id]!
    const [buildingId, measures] = Object.entries(versions.measures)[0]!
    expect(measures.envelope).toMatchObject({ ruleName: 'All buildings' })
    expect(versions.alternativeKwh[buildingId]).toBeLessThan(
      versions.baseKwh[buildingId] ?? 0,
    )
    // A rule edit makes the preview differ from the published versions.
    const rule = scenarioRules(state, scenario)[0]!
    workbench.execute({
      type: 'scenarioRule.save',
      input: {
        scenarioId: scenario.id,
        id: rule.id,
        name: rule.name,
        logic: 'all',
        conditions: [{ field: 'use', operator: 'equals', value: 'office' }],
        measures: rule.measures,
      },
    })
    const edited = workbench.getState()
    const preview = previewScenarioRules(edited, {
      id: scenario.id,
      rules: scenarioRules(edited, edited.scenarios[scenario.id]!),
      adoptionPercent: scenario.adoptionPercent,
      adoptionSeed: scenario.adoptionSeed,
    })
    expect(preview.changes).toBeGreaterThan(0)
    expect(states(workbench)[S.scenarioModeling]).toBe('stale')
  })

  test('leaving a scenario out of the comparison withdraws its result on the next run', () => {
    const workbench = complete()
    const scenario = firstScenario(workbench)
    const input = {
      id: scenario.id,
      name: scenario.name,
      adoptionPercent: scenario.adoptionPercent,
      adoptionSeed: scenario.adoptionSeed,
    }
    workbench.execute({
      type: 'scenario.update',
      input: { ...input, included: false },
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
      input: { ...input, included: true, adoptionPercent: 20 },
    })
    runStageNow(workbench, S.scenarioDefinitions)
    runStageNow(workbench, S.scenarioModeling)
    expect(
      workbench.getState().results.scenarios[scenario.id]?.totalKwh,
    ).toBeGreaterThan(0)
  })

  test('a rule edit during modeling stops the set from publishing', () => {
    const workbench = complete()
    const scenario = firstScenario(workbench)
    workbench.execute({
      type: 'workflow.runStage',
      input: { stageId: S.scenarioModeling },
    })
    const taskId = workbench.getState().taskIds.at(-1) ?? ''
    const before = workbench.getState().results.scenarios
    workbench.execute({ type: 'task.start', input: { taskId } }, 'system')
    // The domain applies the edit; the server's edit lock would refuse it.
    workbench.execute({
      type: 'scenarioRule.setEnabled',
      input: { ruleId: scenario.ruleIds[0] ?? '', enabled: false },
    })
    finishJobNow(workbench, taskId)
    const state = workbench.getState()
    expect(state.tasks[taskId]?.status).toBe('failed')
    expect(state.tasks[taskId]?.message).toMatch(
      /inputs owned by "Scenario definitions" changed/,
    )
    expect(state.results.scenarios).toEqual(before)
  })
})

describe('review fixes', () => {
  test('adoption of a scenario without a result outdates nothing', () => {
    const workbench = complete()
    const envelope = Object.keys(workbench.getState().measures)[0] ?? ''
    workbench.execute({
      type: 'scenario.create',
      input: {
        name: 'Left out',
        measureIds: [envelope],
        adoptionPercent: 30,
        included: false,
      },
    })
    runStageNow(workbench, S.scenarioDefinitions)
    runStageNow(workbench, S.scenarioModeling)
    const leftOut = Object.values(workbench.getState().scenarios).find(
      (scenario) => scenario.name === 'Left out',
    )!
    expect(workbench.getState().results.scenarios[leftOut.id]).toBeUndefined()
    expect(states(workbench)[S.scenarioModeling]).toBe('executed')
    workbench.execute({
      type: 'scenario.update',
      input: {
        id: leftOut.id,
        name: 'Left out',
        adoptionPercent: 70,
        adoptionSeed: 9,
        included: false,
      },
    })
    workbench.execute({
      type: 'scenario.setAdoption',
      input: { scenarioId: leftOut.id, adoptionPercent: 80 },
    })
    expect(states(workbench)).toMatchObject({
      [S.scenarioDefinitions]: 'executed',
      [S.scenarioModeling]: 'executed',
    })
  })

  test('PV rules of scenarios left out of the comparison raise no PV warning', () => {
    const workbench = createWorkbench({
      initialState: buildFixture('partway', () => new Date()),
    })
    const pv = addLibrary(workbench, 'measure:rooftop-pv')
    workbench.execute({
      type: 'scenario.create',
      input: {
        name: 'Solar',
        measureIds: [pv],
        adoptionPercent: 50,
        included: false,
      },
    })
    expect(usesPvWithoutYield(workbench.getState())).toBe(false)
    const solar = firstScenario(workbench)
    workbench.execute({
      type: 'scenario.update',
      input: {
        id: solar.id,
        name: 'Solar',
        adoptionPercent: 50,
        adoptionSeed: 42,
        included: true,
      },
    })
    expect(usesPvWithoutYield(workbench.getState())).toBe(true)
  })

  test('a scenario compares with the baseline its versions were modeled against', () => {
    const workbench = complete()
    const scenario = firstScenario(workbench)
    const state = workbench.getState()
    const versions = state.results.scenarioVersions[scenario.id]!
    const old = state.results.baseline!
    expect(scenarioBaseline(state, scenario.id)).toEqual({
      result: old,
      changed: false,
    })
    // A later working baseline, as after a calibration Adopt.
    const moved = {
      ...state,
      results: {
        ...state.results,
        baseline: {
          ...old,
          runId: 'run-calibrated',
          totalKwh: old.totalKwh * 1.1,
          byBuildingKwh: Object.fromEntries(
            Object.entries(old.byBuildingKwh).map(([id, kwh]) => [
              id,
              kwh * 1.1,
            ]),
          ),
        },
      },
    }
    const compared = scenarioBaseline(moved, scenario.id)!
    expect(compared.changed).toBe(true)
    expect(compared.result.runId).toBe(versions.baselineRunId)
    expect(compared.result.byBuildingKwh).toEqual(versions.baseKwh)
    expect(baselineChangeNote(moved, scenario.id)).toMatch(
      new RegExp(
        `Modeled against baseline run ${old.runId}; the working baseline is now run run-calibrated`,
      ),
    )
    const row = compareScenarios(
      moved,
      deriveStageStates(moved.workflow, moved.tasks),
      S.scenarioModeling,
      S.baseline,
    ).find((item) => item.id === scenario.id)
    const result = state.results.scenarios[scenario.id]!
    expect(row?.reductionPercent).toBe(
      Math.round((1 - result.totalKwh / old.totalKwh) * 1000) / 10,
    )
  })

  test('saving a rule without enabled keeps its switch', () => {
    const workbench = complete()
    const scenario = firstScenario(workbench)
    const rule = scenarioRules(workbench.getState(), scenario)[0]!
    workbench.execute({
      type: 'scenarioRule.setEnabled',
      input: { ruleId: rule.id, enabled: false },
    })
    workbench.execute({
      type: 'scenarioRule.save',
      input: {
        scenarioId: scenario.id,
        id: rule.id,
        name: 'Renamed',
        logic: rule.logic,
        conditions: rule.conditions,
        measures: rule.measures,
      },
    })
    expect(workbench.getState().scenarioRules[rule.id]).toMatchObject({
      name: 'Renamed',
      enabled: false,
    })
  })
})
