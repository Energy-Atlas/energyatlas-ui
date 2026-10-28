import { describe, expect, test } from 'vitest'
import { ARCHETYPE_LIBRARY } from '../domain/archetypes/library.ts'
import { effectiveParts } from '../domain/archetypes/parts.ts'
import { runStageNow } from '../domain/jobs/runNow.ts'
import { createWorkbench } from '../domain/workbench.ts'
import { STAGE_IDS, deriveStageStates } from '../domain/workflow.ts'
import { buildFixture } from './fixtures.ts'
import { legacySave } from '../testing/legacySave.ts'
import { legacyScenarioSave } from '../testing/legacyScenarioSave.ts'
import {
  previewScenarioRules,
  scenarioRules,
} from '../domain/scenarios/rules.ts'
import {
  SCENARIO_MIGRATION_ISSUE_ID,
  migratedScenarioRuleId,
} from './migrateScenarios.ts'
import { MIGRATION_ISSUE_ID, migratedRuleId } from './migrateArchetypes.ts'
import { projectStateSchema } from './projectSchema.ts'

const flat = (value: number) => Array.from({ length: 24 }, () => value)

describe('saved project schema', () => {
  test('loads a schedule saved before day types as Weekday and Weekend', () => {
    const state = buildFixture('complete', () => new Date())
    const saved = JSON.parse(JSON.stringify(state)) as Record<string, unknown>
    saved.schedules = {
      'schedule-1': {
        id: 'schedule-1',
        name: 'Old office',
        weekday: flat(0.5),
        weekend: flat(0.1),
        source: { kind: 'project', operationId: 'op-1' },
      },
    }
    const parsed = projectStateSchema.parse(saved)
    expect(parsed.schedules['schedule-1']).toMatchObject({
      days: [
        { id: 'weekday', name: 'Weekday', hours: flat(0.5) },
        { id: 'weekend', name: 'Weekend', hours: flat(0.1) },
      ],
      week: [
        'weekday',
        'weekday',
        'weekday',
        'weekday',
        'weekday',
        'weekend',
        'weekend',
      ],
    })
  })

  test('migrates a save from before archetype parts and keeps its assignment', () => {
    const state = buildFixture('complete', () => new Date())
    const parsed = projectStateSchema.parse(legacySave(state))
    // Library archetypes take the library parts; a project archetype takes
    // the nearest library bundle of its use and keeps its own schedule.
    expect(parsed.archetypes['archetype:office']?.parts).toEqual(
      ARCHETYPE_LIBRARY.find((entry) => entry.id === 'archetype:office')?.parts,
    )
    const night = parsed.archetypes['archetype-90']!
    expect(parsed.parts[night.parts.spaceLoads ?? '']).toMatchObject({
      kind: 'spaceLoads',
      scheduleId: 'schedule:residential',
      name: 'Night office space loads',
    })
    // Buildings keep the parts of their old archetype, by its migrated rule.
    const office = parsed.buildingIds.find(
      (id) =>
        parsed.buildings[id]?.use === 'office' &&
        parsed.buildings[id]?.parts.construction !== null,
    )!
    expect(parsed.buildings[office]?.parts.systems).toEqual({
      partId: 'systems:office-vav',
      ruleId: migratedRuleId('archetype:office'),
      ruleName: 'Office',
    })
    // Archetype modeling had run, so its default rules exist, fallback last.
    expect(parsed.ruleIds).toContain(migratedRuleId('archetype:office'))
    expect(parsed.ruleIds.at(-1)).toBe(migratedRuleId('fallback'))
    // A manual archetype becomes four manual parts; a manual none is dropped.
    expect(
      effectiveParts(parsed, parsed.buildings.B0001!).spaceLoads,
    ).toMatchObject({ partId: 'loads:school', via: 'manual' })
    expect(
      Object.keys(parsed.overrides).filter((key) => key.startsWith('B0002:')),
    ).toEqual([])
    // The migrated project runs assignment again.
    const workbench = createWorkbench({ initialState: parsed })
    expect(runStageNow(workbench, STAGE_IDS.archetypes).outcome.status).toBe(
      'applied',
    )
  })

  test('an edited library archetype keeps its own schedule', () => {
    const parsed = projectStateSchema.parse(
      legacySave(buildFixture('complete', () => new Date())),
    )
    const retail = parsed.archetypes['archetype:retail']!
    expect(retail.source).toEqual({
      kind: 'project',
      operationId: 'op-89',
      libraryId: 'archetype:retail',
    })
    expect(parsed.parts[retail.parts.spaceLoads ?? '']).toMatchObject({
      kind: 'spaceLoads',
      scheduleId: 'schedule:office',
    })
    // An untouched library copy takes the library parts.
    expect(parsed.archetypes['archetype:school']?.parts.spaceLoads).toBe(
      'loads:school',
    )
  })

  test('marks results from old single intensities outdated, with an issue', () => {
    const state = buildFixture('complete', () => new Date())
    const parsed = projectStateSchema.parse(legacySave(state))
    const stages = deriveStageStates(parsed.workflow, parsed.tasks)
    expect(stages[STAGE_IDS.archetypes]).toBe('executed')
    expect(stages[STAGE_IDS.baseline]).toBe('stale')
    expect(stages[STAGE_IDS.scenarioModeling]).toBe('stale')
    expect(parsed.nextId).toBe(state.nextId + 1)
    expect(
      parsed.issues.find((issue) => issue.id === MIGRATION_ISSUE_ID),
    ).toMatchObject({ severity: 'warning', stageId: STAGE_IDS.baseline })
    // A save from after parts is left alone.
    const current = projectStateSchema.parse(JSON.parse(JSON.stringify(state)))
    expect(
      deriveStageStates(current.workflow, current.tasks)[STAGE_IDS.baseline],
    ).toBe('executed')
  })

  test('invalidates an open assignment run saved before parts', () => {
    const state = buildFixture('complete', () => new Date())
    const saved = legacySave(state)
    const taskId = state.taskIds.find(
      (id) => state.tasks[id]?.stageId === STAGE_IDS.archetypes,
    )!
    const groupId = state.tasks[taskId]!.groupId!
    const group = saved.runGroups[groupId] ?? {}
    group.status = 'open'
    group.held = {
      B0001: { kind: 'assignment', archetypeId: 'archetype:office' },
    }
    const parsed = projectStateSchema.parse(saved)
    expect(parsed.runGroups[groupId]).toMatchObject({
      status: 'invalidated',
      held: {},
    })
  })

  test('keeps a selected definition in the saved selection', () => {
    const state = buildFixture('complete', () => new Date())
    const archetypeId = Object.keys(state.archetypes)[0] ?? ''
    const parsed = projectStateSchema.parse({
      ...state,
      selection: { entityType: 'archetype', ids: [archetypeId] },
    })
    expect(parsed.selection).toEqual({
      entityType: 'archetype',
      ids: [archetypeId],
    })
  })
})

describe('saves from before scenario rules', () => {
  function oldProject() {
    const workbench = createWorkbench({
      initialState: buildFixture('complete', () => new Date()),
    })
    workbench.execute({
      type: 'measure.addFromLibrary',
      input: { libraryId: 'measure:heat-pumps' },
    })
    const state = workbench.getState()
    const envelope = Object.values(state.measures).find(
      (measure) => measure.kind === 'envelope',
    )!
    const pumps = Object.values(state.measures).find(
      (measure) => measure.kind === 'heating',
    )!
    workbench.execute({
      type: 'scenario.create',
      input: {
        name: 'Homes',
        measureIds: [envelope.id, pumps.id],
        adoptionPercent: 30,
      },
    })
    return { state: workbench.getState(), envelope, pumps }
  }

  test('turns each measure list into rules by the use the measures applied to', () => {
    const { state, envelope, pumps } = oldProject()
    const saved = legacyScenarioSave(state, { [pumps.id]: 'residential' })
    const parsed = projectStateSchema.parse(saved)
    const homes = Object.values(parsed.scenarios).find(
      (scenario) => scenario.name === 'Homes',
    )!
    expect(homes.adoptionSeed).toBe(42)
    expect(homes.ruleIds).toEqual([
      migratedScenarioRuleId(homes.id, 'residential'),
      migratedScenarioRuleId(homes.id, 'all'),
    ])
    expect(parsed.scenarioRules[homes.ruleIds[0]!]).toMatchObject({
      name: 'Residential buildings',
      conditions: [{ field: 'use', operator: 'equals', value: 'residential' }],
      measures: { heating: pumps.id, envelope: null },
    })
    expect(parsed.scenarioRules[homes.ruleIds[1]!]).toMatchObject({
      name: 'All buildings',
      conditions: [],
      measures: { envelope: envelope.id, heating: null },
    })
    expect(parsed.measures[pumps.id]).not.toHaveProperty('appliesTo')
    // Each building takes the measures its use took before.
    const preview = previewScenarioRules(parsed, {
      id: homes.id,
      rules: scenarioRules(parsed, homes),
      adoptionPercent: homes.adoptionPercent,
      adoptionSeed: homes.adoptionSeed,
    })
    for (const [id, measures] of Object.entries(preview.byBuilding)) {
      const residential = parsed.buildings[id]?.use === 'residential'
      expect(measures.envelope?.measureId).toBe(envelope.id)
      expect(measures.heating?.measureId ?? null).toBe(
        residential ? pumps.id : null,
      )
    }
  })

  test('marks scenario results outdated with an issue and keeps them readable', () => {
    const state = buildFixture('complete', () => new Date())
    const parsed = projectStateSchema.parse(legacyScenarioSave(state))
    const stages = deriveStageStates(parsed.workflow, parsed.tasks)
    expect(stages[STAGE_IDS.baseline]).toBe('executed')
    expect(stages[STAGE_IDS.scenarioDefinitions]).toBe('stale')
    expect(stages[STAGE_IDS.scenarioModeling]).toBe('stale')
    expect(
      parsed.issues.find((issue) => issue.id === SCENARIO_MIGRATION_ISSUE_ID),
    ).toMatchObject({
      severity: 'warning',
      stageId: STAGE_IDS.scenarioModeling,
    })
    expect(Object.keys(parsed.results.scenarios)).toHaveLength(1)
    expect(parsed.results.scenarioVersions).toEqual({})
    // Without versions, a new adoption cannot re-aggregate; it stays outdated.
    const workbench = createWorkbench({ initialState: parsed })
    const scenario = Object.values(parsed.scenarios)[0]!
    workbench.execute({
      type: 'scenario.setAdoption',
      input: { scenarioId: scenario.id, adoptionPercent: 70 },
    })
    expect(workbench.getState().results.scenarios[scenario.id]).toEqual(
      parsed.results.scenarios[scenario.id],
    )
    // Modeling again publishes versions, and adoption re-aggregates from then on.
    runStageNow(workbench, STAGE_IDS.scenarioDefinitions)
    runStageNow(workbench, STAGE_IDS.scenarioModeling)
    expect(
      workbench.getState().results.scenarioVersions[scenario.id],
    ).toBeDefined()
    // A save from after scenario rules is left alone.
    const current = projectStateSchema.parse(JSON.parse(JSON.stringify(state)))
    expect(
      deriveStageStates(current.workflow, current.tasks)[
        STAGE_IDS.scenarioModeling
      ],
    ).toBe('executed')
  })

  test('invalidates an open Scenario modeling run saved before versions', () => {
    const state = buildFixture('complete', () => new Date())
    const saved = legacyScenarioSave(state)
    const taskId = state.taskIds.find(
      (id) => state.tasks[id]?.stageId === STAGE_IDS.scenarioModeling,
    )!
    const groupId = state.tasks[taskId]!.groupId!
    const group = saved.runGroups[groupId] ?? {}
    group.status = 'open'
    const scenarioId = Object.keys(state.scenarios)[0]!
    group.held = {
      [scenarioId]: {
        kind: 'scenarioResult',
        result: state.results.scenarios[scenarioId],
      },
    }
    const parsed = projectStateSchema.parse(saved)
    expect(parsed.runGroups[groupId]).toMatchObject({
      status: 'invalidated',
      held: {},
    })
  })
})
