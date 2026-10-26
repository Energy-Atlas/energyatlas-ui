import { describe, expect, it } from 'vitest'
import { deriveStageStates, STAGE_IDS } from '../domain/workflow.ts'
import { buildFixture, FIXTURE_IDS } from './fixtures.ts'

const now = () => new Date('2026-10-25T12:00:00.000Z')

describe('project fixtures', () => {
  it('builds each fixture by running the workflow', () => {
    const states = Object.fromEntries(
      FIXTURE_IDS.map((id) => {
        const state = buildFixture(id, now)
        return [id, deriveStageStates(state.workflow, state.tasks)]
      }),
    )
    expect(Object.values(states.new ?? {})).not.toContain('executed')
    expect(states.partway?.[STAGE_IDS.preprocessing]).toBe('executed')
    expect(states.partway?.[STAGE_IDS.archetypes]).not.toBe('executed')
    expect(states.failed?.[STAGE_IDS.gridModeling]).toBe('failed')
    expect(states.complete?.[STAGE_IDS.gridModeling]).toBe('executed')
    expect(states.complete?.[STAGE_IDS.dashboard]).toBe('executed')
  })

  it('leaves a schema matching warning partway', () => {
    const state = buildFixture('partway', now)
    expect(
      state.issues.some(
        (issue) =>
          issue.severity === 'warning' && issue.stageId === STAGE_IDS.schema,
      ),
    ).toBe(true)
  })
})
