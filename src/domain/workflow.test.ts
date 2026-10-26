import { describe, expect, test } from 'vitest'
import type { StageRecord, Task, WorkflowState } from './types.ts'
import {
  STAGE_IDS,
  createDefaultWorkflow,
  deriveStageStates,
  stageRunBlocker,
  topologicalOrder,
} from './workflow.ts'

function stage(workflow: WorkflowState, id: string): StageRecord {
  const record = workflow.stages[id]
  if (!record) throw new Error(`Missing stage ${id}`)
  return record
}

function succeed(
  workflow: WorkflowState,
  id: string,
  inputRevisions: Record<string, number>,
  revision: number,
) {
  const record = stage(workflow, id)
  record.revision = revision
  record.lastRun = {
    runId: `run-${id}`,
    operationId: 'op-test',
    outcome: 'succeeded',
    message: null,
    inputRevisions,
    inputEditRevision: record.editRevision,
    finishedAt: '2026-09-14T12:00:00.000Z',
  }
}

describe('topologicalOrder', () => {
  test('follows stage order for the default linear workflow', () => {
    const workflow = createDefaultWorkflow()
    expect(topologicalOrder(workflow.stageIds, workflow.edges)).toEqual(
      workflow.stageIds,
    )
  })

  test('returns null for cycles and unknown stages', () => {
    expect(
      topologicalOrder(
        ['a', 'b'],
        [
          { from: 'a', to: 'b' },
          { from: 'b', to: 'a' },
        ],
      ),
    ).toBeNull()
    expect(topologicalOrder(['a'], [{ from: 'a', to: 'missing' }])).toBeNull()
  })
})

describe('deriveStageStates', () => {
  test('makes only the first stage ready in a fresh workflow', () => {
    const workflow = createDefaultWorkflow()
    const states = deriveStageStates(workflow, {})
    expect(states[STAGE_IDS.location]).toBe('ready')
    expect(states[STAGE_IDS.enrichment]).toBe('future')
    expect(Object.keys(states)).toHaveLength(12)
  })

  test('marks a stage stale when an upstream revision changes after it ran', () => {
    const workflow = createDefaultWorkflow()
    succeed(workflow, STAGE_IDS.location, {}, 1)
    succeed(workflow, STAGE_IDS.enrichment, { [STAGE_IDS.location]: 1 }, 2)
    expect(deriveStageStates(workflow, {})[STAGE_IDS.enrichment]).toBe(
      'executed',
    )

    stage(workflow, STAGE_IDS.location).revision = 3
    const states = deriveStageStates(workflow, {})
    expect(states[STAGE_IDS.enrichment]).toBe('stale')
    expect(states[STAGE_IDS.schema]).toBe('future')
  })

  test('marks a stage stale when its own inputs are edited', () => {
    const workflow = createDefaultWorkflow()
    succeed(workflow, STAGE_IDS.location, {}, 1)
    stage(workflow, STAGE_IDS.location).editRevision = 5
    expect(deriveStageStates(workflow, {})[STAGE_IDS.location]).toBe('stale')
  })

  test('distinguishes unavailable, blocked, and running stages', () => {
    const workflow = createDefaultWorkflow()
    succeed(workflow, STAGE_IDS.location, {}, 1)
    stage(workflow, STAGE_IDS.enrichment).unavailableReason =
      'Planned: not available in this prototype.'
    const states = deriveStageStates(workflow, {})
    expect(states[STAGE_IDS.enrichment]).toBe('unavailable')
    expect(states[STAGE_IDS.schema]).toBe('blocked')
    expect(stageRunBlocker(workflow, {}, STAGE_IDS.enrichment)).toBe(
      'Planned: not available in this prototype.',
    )

    const runningTask: Task = {
      id: 'task-1',
      label: 'Location',
      stageId: STAGE_IDS.location,
      runId: 'run-1',
      status: 'running',
      progress: 0.5,
      message: null,
      source: 'manual',
      createdAt: '2026-09-14T12:00:00.000Z',
      updatedAt: '2026-09-14T12:00:00.000Z',
      log: [],
      groupId: null,
      attempt: 1,
      parentTaskId: null,
      requestId: null,
      items: null,
    }
    expect(
      deriveStageStates(workflow, { 'task-1': runningTask })[
        STAGE_IDS.location
      ],
    ).toBe('running')
  })

  test('treats skipped upstream stages as satisfied', () => {
    const workflow = createDefaultWorkflow()
    stage(workflow, STAGE_IDS.location).skipped = true
    expect(deriveStageStates(workflow, {})[STAGE_IDS.enrichment]).toBe('ready')
  })
})
