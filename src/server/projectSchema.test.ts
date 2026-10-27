import { describe, expect, test } from 'vitest'
import { buildFixture } from './fixtures.ts'
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
