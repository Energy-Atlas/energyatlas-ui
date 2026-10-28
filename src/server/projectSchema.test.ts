import { describe, expect, test } from 'vitest'
import { ARCHETYPE_LIBRARY } from '../domain/archetypes/library.ts'
import { effectiveParts } from '../domain/archetypes/parts.ts'
import { runStageNow } from '../domain/jobs/runNow.ts'
import { createWorkbench } from '../domain/workbench.ts'
import { STAGE_IDS } from '../domain/workflow.ts'
import { buildFixture } from './fixtures.ts'
import { legacySave } from '../testing/legacySave.ts'
import { migratedRuleId } from './migrateArchetypes.ts'
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
