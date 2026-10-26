import { describe, expect, test } from 'vitest'
import { buildFixture } from '../../server/fixtures.ts'
import { finishJobNow, runStageNow } from '../jobs/runNow.ts'
import { retryBlocker } from '../jobs/runGroups.ts'
import { createWorkbench, type Workbench } from '../workbench.ts'
import { STAGE_IDS, deriveStageStates } from '../workflow.ts'
import {
  matchArchetype,
  previewAssignment,
  scheduleStats,
} from './assignment.ts'
import { ARCHETYPE_LIBRARY, SCHEDULE_LIBRARY } from './library.ts'

const S = STAGE_IDS

/** The Partway fixture with shading skipped, so Archetype modeling is ready. */
function partway(): Workbench {
  const workbench = createWorkbench({
    initialState: buildFixture('partway', () => new Date()),
  })
  workbench.execute({
    type: 'workflow.setStageSkipped',
    input: { stageId: STAGE_IDS.shading, skipped: true },
  })
  return workbench
}

function states(workbench: Workbench) {
  const state = workbench.getState()
  return deriveStageStates(state.workflow, state.tasks)
}

const flat = (value: number) => Array.from({ length: 24 }, () => value)

describe('archetype definitions', () => {
  test('the narrowest matching year range wins, then the id', () => {
    const library = Object.fromEntries(
      ARCHETYPE_LIBRARY.map((entry) => [entry.id, entry]),
    )
    expect(matchArchetype(library, { use: 'office', yearBuilt: 1930 })).toBe(
      'archetype:office-pre-1950',
    )
    expect(matchArchetype(library, { use: 'office', yearBuilt: 1990 })).toBe(
      'archetype:office',
    )
    expect(
      matchArchetype(library, { use: 'residential', yearBuilt: 1979 }),
    ).toBe('archetype:residential-pre-1980')
    expect(
      matchArchetype(library, { use: 'residential', yearBuilt: null }),
    ).toBeNull()
  })

  test('schedule statistics count five weekdays and two weekend days', () => {
    expect(scheduleStats({ weekday: flat(1), weekend: flat(0) })).toEqual({
      weeklyHours: 120,
      annualHours: 120 * 52 + 24,
      min: 0,
      max: 1,
    })
    for (const schedule of SCHEDULE_LIBRARY) {
      expect(schedule.weekday).toHaveLength(24)
      expect(schedule.weekend).toHaveLength(24)
    }
  })

  test('validates definitions per field and undoes a saved archetype', () => {
    const workbench = partway()
    const invalid = workbench.execute({
      type: 'archetype.save',
      input: {
        name: 'Broken range',
        use: 'office',
        yearFrom: 2000,
        yearTo: 1990,
        euiKwhPerM2: 150,
        scheduleId: null,
      },
    })
    expect(invalid.outcome).toMatchObject({
      status: 'rejected',
      issues: [{ path: 'yearTo' }],
    })
    expect(
      workbench.execute({
        type: 'archetype.save',
        input: {
          name: 'Unknown schedule',
          use: 'office',
          yearFrom: null,
          yearTo: null,
          euiKwhPerM2: 150,
          scheduleId: 'schedule:missing',
        },
      }).outcome,
    ).toMatchObject({ status: 'rejected', issues: [{ path: 'scheduleId' }] })
    const saved = workbench.execute({
      type: 'archetype.save',
      input: {
        name: 'Office 1990s',
        use: 'office',
        yearFrom: 1990,
        yearTo: 1999,
        euiKwhPerM2: 150,
        scheduleId: null,
      },
    })
    expect(saved.outcome.status).toBe('applied')
    expect(Object.values(workbench.getState().archetypes)).toHaveLength(1)
    workbench.undo()
    expect(Object.values(workbench.getState().archetypes)).toHaveLength(0)
  })

  test('rejects a schedule without 24 values in range or with no hours', () => {
    const workbench = partway()
    const short = workbench.execute({
      type: 'schedule.save',
      input: { name: 'Short', weekday: [0.5], weekend: flat(0) },
    })
    expect(short.outcome).toMatchObject({
      status: 'rejected',
      issues: [{ path: 'weekday' }],
    })
    const high = workbench.execute({
      type: 'schedule.save',
      input: { name: 'High', weekday: flat(2), weekend: flat(0) },
    })
    expect(high.outcome.status).toBe('rejected')
    const empty = workbench.execute({
      type: 'schedule.save',
      input: { name: 'Empty', weekday: flat(0), weekend: flat(0) },
    })
    expect(empty.outcome).toMatchObject({
      status: 'rejected',
      issues: [{ message: 'A schedule needs at least one hour above 0.' }],
    })
  })
})

describe('assignment jobs', () => {
  test('a first run starts from the default library and keeps earlier behavior', () => {
    const workbench = partway()
    runStageNow(workbench, S.archetypes)
    const state = workbench.getState()
    expect(Object.keys(state.archetypes)).toHaveLength(5)
    expect(Object.keys(state.schedules).sort()).toEqual([
      'schedule:office',
      'schedule:residential',
      'schedule:retail',
      'schedule:school',
    ])
    expect(states(workbench)[S.archetypes]).toBe('executed')
    const mixed = state.buildingIds.filter(
      (id) => state.buildings[id]?.use === 'mixed',
    )
    expect(mixed.every((id) => state.buildings[id]?.archetypeId === null)).toBe(
      true,
    )
  })

  test('holds assignments until every building succeeds, then publishes them under overrides', () => {
    const workbench = partway()
    runStageNow(workbench, S.archetypes)
    workbench.execute({
      type: 'archetype.addFromLibrary',
      input: { libraryId: 'archetype:mixed' },
    })
    expect(states(workbench)[S.archetypes]).toBe('stale')
    workbench.execute({
      type: 'edits.propose',
      input: {
        entityId: 'B0001',
        field: 'archetypeId',
        value: 'archetype:school',
      },
    })
    workbench.execute({ type: 'edits.apply', input: {} })
    expect(previewAssignment(workbench.getState()).overrides).toBe(1)

    workbench.execute({
      type: 'workflow.runStage',
      input: { stageId: S.archetypes },
    })
    const taskId = workbench.getState().taskIds.at(-1) ?? ''
    const mixedId =
      workbench
        .getState()
        .buildingIds.find(
          (id) =>
            id !== 'B0001' &&
            workbench.getState().buildings[id]?.use === 'mixed',
        ) ?? ''
    finishJobNow(workbench, taskId, { failures: { [mixedId]: 'Fault.' } })
    expect(workbench.getState().buildings[mixedId]?.archetypeId).toBeNull()
    expect(retryBlocker(workbench.getState(), taskId)).toBeNull()
    workbench.execute({ type: 'job.retry', input: { taskId } })
    finishJobNow(workbench, workbench.getState().taskIds.at(-1) ?? '')
    const state = workbench.getState()
    expect(state.buildings[mixedId]?.archetypeId).toBe('archetype:mixed')
    expect(state.buildings.B0001?.archetypeId).toBe('archetype:school')
    expect(states(workbench)[S.archetypes]).toBe('executed')
    expect(states(workbench)[S.baseline]).toBe('ready')
  })

  test('editing a definition outdates assignment and refuses retries of the old run', () => {
    const workbench = partway()
    runStageNow(workbench, S.archetypes)
    workbench.execute({
      type: 'workflow.runStage',
      input: { stageId: S.archetypes },
    })
    const taskId = workbench.getState().taskIds.at(-1) ?? ''
    finishJobNow(workbench, taskId, { failures: { B0002: 'Fault.' } })
    const office = workbench.getState().archetypes['archetype:office']
    if (!office) throw new Error('Missing office archetype')
    workbench.execute({
      type: 'archetype.save',
      input: {
        id: office.id,
        name: office.name,
        use: office.use,
        yearFrom: office.yearFrom,
        yearTo: office.yearTo,
        euiKwhPerM2: 190,
        scheduleId: office.scheduleId,
      },
    })
    expect(retryBlocker(workbench.getState(), taskId)).toMatch(
      /inputs owned by "Archetype modeling" changed/,
    )
  })
})
