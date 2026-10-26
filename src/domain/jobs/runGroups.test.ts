import { describe, expect, test } from 'vitest'
import { buildFixture } from '../../server/fixtures.ts'
import { createWorkbench, type Workbench } from '../workbench.ts'
import { STAGE_IDS, deriveStageStates } from '../workflow.ts'
import { finishJobNow, runStageNow } from './runNow.ts'
import {
  captureSignature,
  itemCounts,
  itemStatusOf,
  retryBlocker,
  retryScope,
  signatureMismatch,
} from './runGroups.ts'

const S = STAGE_IDS

function setup(): Workbench {
  const workbench = createWorkbench({
    now: () => new Date('2026-10-26T12:00:00.000Z'),
  })
  for (const stageId of [S.location, S.enrichment, S.schema]) {
    runStageNow(workbench, stageId)
  }
  return workbench
}

function lastTaskId(workbench: Workbench): string {
  return workbench.getState().taskIds.at(-1) ?? ''
}

function states(workbench: Workbench) {
  const state = workbench.getState()
  return deriveStageStates(state.workflow, state.tasks)
}

/** Queues preprocessing and fails the given building indexes. */
function partlyFailPreprocessing(workbench: Workbench, indexes: number[]) {
  workbench.execute({
    type: 'workflow.runStage',
    input: { stageId: S.preprocessing },
  })
  const taskId = lastTaskId(workbench)
  const ids = workbench.getState().buildingIds
  const failures = Object.fromEntries(
    indexes.map((index) => [ids[index] ?? '', 'Transient fault.']),
  )
  finishJobNow(workbench, taskId, { failures })
  return taskId
}

describe('run groups', () => {
  test('capture every upstream revision, the edit revision, and membership', () => {
    const workbench = setup()
    const state = workbench.getState()
    const signature = captureSignature(state, S.preprocessing)
    expect(Object.keys(signature.ancestors).sort()).toEqual(
      [S.location, S.enrichment, S.schema].sort(),
    )
    expect(signature.membership).toEqual(state.buildingIds)
    expect(captureSignature(state, S.baseline).membership).toEqual([])
  })

  test('hold successful items, publish nothing, and retry only the failed ones', () => {
    const workbench = setup()
    const shadingRevisionBefore =
      workbench.getState().workflow.stages[S.preprocessing]?.revision
    const first = partlyFailPreprocessing(workbench, [3, 40])
    let state = workbench.getState()
    const task = state.tasks[first]
    const group = state.runGroups[task?.groupId ?? '']
    expect(task?.status).toBe('failed')
    expect(itemCounts(task!)).toMatchObject({
      total: 464,
      succeeded: 462,
      failed: 2,
    })
    expect(itemStatusOf(task!, 3)).toBe('failed')
    expect(itemStatusOf(task!, 4)).toBe('succeeded')
    expect(Object.keys(group?.held ?? {})).toHaveLength(462)
    // Held outputs never reach the project.
    expect(
      state.buildingIds.every((id) => state.buildings[id]?.heightM === null),
    ).toBe(true)
    expect(state.workflow.stages[S.preprocessing]?.revision).toBe(
      shadingRevisionBefore,
    )
    expect(states(workbench)[S.preprocessing]).toBe('failed')
    expect(retryScope(group!)).toBe('Retry 2 failed items')
    expect(retryBlocker(state, first)).toBeNull()

    const retried = workbench.execute({
      type: 'job.retry',
      input: { taskId: first },
    })
    expect(retried.outcome.status).toBe('applied')
    const second = lastTaskId(workbench)
    state = workbench.getState()
    expect(state.tasks[second]).toMatchObject({
      attempt: 2,
      parentTaskId: first,
      groupId: task?.groupId,
    })
    expect(state.tasks[second]?.items?.ids).toEqual([
      state.buildingIds[3],
      state.buildingIds[40],
    ])
    finishJobNow(workbench, second)
    state = workbench.getState()
    expect(state.tasks[second]?.status).toBe('succeeded')
    // The first attempt keeps its own outcome.
    expect(state.tasks[first]?.status).toBe('failed')
    expect(state.runGroups[task?.groupId ?? '']).toMatchObject({
      status: 'published',
      held: {},
    })
    expect(
      state.buildingIds.every((id) => state.buildings[id]?.heightM !== null),
    ).toBe(true)
    expect(states(workbench)[S.preprocessing]).toBe('executed')
    expect(states(workbench)[S.shading]).toBe('ready')
  })

  test('publish once, incrementing the stage revision once and staling dependents', () => {
    const workbench = setup()
    runStageNow(workbench, S.preprocessing)
    runStageNow(workbench, S.shading)
    expect(states(workbench)[S.shading]).toBe('executed')
    const before = workbench.getState().nextId
    const revisionBefore =
      workbench.getState().workflow.stages[S.preprocessing]?.revision ?? 0
    const failed = partlyFailPreprocessing(workbench, [0])
    expect(states(workbench)[S.shading]).toBe('stale')
    workbench.execute({ type: 'job.retry', input: { taskId: failed } })
    finishJobNow(workbench, lastTaskId(workbench))
    const revision =
      workbench.getState().workflow.stages[S.preprocessing]?.revision ?? 0
    expect(revision).toBeGreaterThan(revisionBefore)
    expect(revision).toBeGreaterThanOrEqual(before)
    expect(states(workbench)[S.shading]).toBe('stale')
  })

  test('refuse a retry once a consumed input changed, and require a fresh run', () => {
    const workbench = setup()
    const failed = partlyFailPreprocessing(workbench, [1])
    workbench.execute({
      type: 'edits.propose',
      input: { entityId: 'B0001', field: 'floors', value: 9 },
    })
    workbench.execute({ type: 'edits.apply', input: {} })
    const blocker = retryBlocker(workbench.getState(), failed)
    expect(blocker).toMatch(/Inputs changed.*Geospatial data enriching/)
    expect(
      workbench.execute({ type: 'job.retry', input: { taskId: failed } })
        .outcome,
    ).toMatchObject({ status: 'rejected', issues: [{ path: 'taskId' }] })

    // A fresh run, once its upstream is current again, starts a new group.
    runStageNow(workbench, S.schema)
    const fresh = runStageNow(workbench, S.preprocessing)
    expect(fresh.outcome.status).toBe('applied')
    const state = workbench.getState()
    const oldGroup = state.runGroups[state.tasks[failed]?.groupId ?? '']
    expect(oldGroup).toMatchObject({ status: 'superseded', held: {} })
    // The manual override is used by the fresh run.
    expect(state.buildings.B0001?.heightM).toBeCloseTo(9 * 3.2)
  })

  test('selection, drafts, and focus are not inputs', () => {
    const workbench = setup()
    const failed = partlyFailPreprocessing(workbench, [1])
    workbench.execute({
      type: 'selection.set',
      input: { entityType: 'building', ids: ['B0002'] },
    })
    workbench.execute({
      type: 'edits.propose',
      input: { entityId: 'B0001', field: 'floors', value: 9 },
    })
    workbench.execute({
      type: 'workflow.setCurrentStage',
      input: { stageId: S.location },
    })
    expect(retryBlocker(workbench.getState(), failed)).toBeNull()
  })

  test('a changed item membership is an input change', () => {
    const workbench = setup()
    const failed = partlyFailPreprocessing(workbench, [1])
    const state = workbench.getState()
    const group = state.runGroups[state.tasks[failed]?.groupId ?? '']!
    const fewer = { ...state, buildingIds: state.buildingIds.slice(1) }
    expect(signatureMismatch(fewer, group)).toBe('the set of buildings changed')
  })

  test('a failed publication keeps every result held for a publication retry', () => {
    const workbench = setup()
    workbench.execute({
      type: 'workflow.runStage',
      input: { stageId: S.preprocessing },
    })
    const first = lastTaskId(workbench)
    finishJobNow(workbench, first, { failPublication: 'store unavailable' })
    let state = workbench.getState()
    const group = state.runGroups[state.tasks[first]?.groupId ?? '']!
    expect(state.tasks[first]?.status).toBe('failed')
    expect(state.tasks[first]?.message).toMatch(/Publication failed/)
    expect(Object.keys(group.held)).toHaveLength(464)
    expect(state.buildings.B0001?.heightM).toBeNull()
    expect(retryScope(group)).toBe('Retry publication of held results')

    workbench.execute({ type: 'job.retry', input: { taskId: first } })
    const second = lastTaskId(workbench)
    expect(workbench.getState().tasks[second]?.items?.ids).toEqual([])
    finishJobNow(workbench, second)
    state = workbench.getState()
    expect(state.tasks[second]?.status).toBe('succeeded')
    expect(state.buildings.B0001?.heightM).not.toBeNull()
  })

  test('cancellation publishes nothing, keeps diagnostics, and needs a fresh run', () => {
    const workbench = setup()
    workbench.execute({
      type: 'workflow.runStage',
      input: { stageId: S.preprocessing },
    })
    const taskId = lastTaskId(workbench)
    workbench.execute({ type: 'task.start', input: { taskId } }, 'system')
    workbench.execute(
      { type: 'task.processItems', input: { taskId, count: 100 } },
      'system',
    )
    workbench.execute({ type: 'task.cancel', input: { taskId } })
    const state = workbench.getState()
    const task = state.tasks[taskId]!
    expect(itemCounts(task)).toMatchObject({ succeeded: 100, unprocessed: 364 })
    expect(itemStatusOf(task, 200)).toBe('cancelled')
    expect(state.runGroups[task.groupId ?? '']).toMatchObject({
      status: 'cancelled',
      held: {},
    })
    expect(state.buildings.B0001?.heightM).toBeNull()
    expect(retryBlocker(state, taskId)).toMatch(/start a fresh run/)
    expect(
      workbench.execute({ type: 'task.complete', input: { taskId } }, 'system')
        .outcome.status,
    ).toBe('rejected')
  })

  test('an execution-wide failure keeps computed items and retries the rest', () => {
    const workbench = setup()
    workbench.execute({
      type: 'workflow.runStage',
      input: { stageId: S.preprocessing },
    })
    const taskId = lastTaskId(workbench)
    workbench.execute({ type: 'task.start', input: { taskId } }, 'system')
    workbench.execute(
      { type: 'task.processItems', input: { taskId, count: 200 } },
      'system',
    )
    workbench.execute(
      { type: 'task.fail', input: { taskId, message: 'Server error.' } },
      'system',
    )
    const state = workbench.getState()
    const group = state.runGroups[state.tasks[taskId]?.groupId ?? '']!
    expect(itemStatusOf(state.tasks[taskId]!, 300)).toBe('notProcessed')
    expect(retryScope(group)).toBe('Retry 264 failed items')
  })

  test('a repeated submission creates no duplicate job', () => {
    const workbench = setup()
    const run = {
      type: 'workflow.runStage' as const,
      input: { stageId: S.preprocessing, requestId: 'request-1' },
    }
    workbench.execute(run)
    const count = workbench.getState().taskIds.length
    const again = workbench.execute(run)
    expect(again.outcome).toMatchObject({ status: 'applied' })
    expect(workbench.getState().taskIds).toHaveLength(count)

    const failed = lastTaskId(workbench)
    finishJobNow(workbench, failed, { failures: { B0001: 'Fault.' } })
    const retry = {
      type: 'job.retry' as const,
      input: { taskId: failed, requestId: 'request-2' },
    }
    workbench.execute(retry)
    workbench.execute(retry)
    expect(workbench.getState().taskIds).toHaveLength(count + 1)
  })

  test('a queued attempt whose inputs changed finishes without running', () => {
    const workbench = setup()
    const failed = partlyFailPreprocessing(workbench, [1])
    workbench.execute({ type: 'job.retry', input: { taskId: failed } })
    const retry = lastTaskId(workbench)
    // An earlier queued job publishes new upstream output first.
    runStageNow(workbench, S.location)
    workbench.execute(
      { type: 'task.start', input: { taskId: retry } },
      'system',
    )
    const state = workbench.getState()
    expect(state.tasks[retry]).toMatchObject({ status: 'invalidated' })
    expect(state.tasks[retry]?.message).toMatch(/fresh run/)
    expect(state.runGroups[state.tasks[retry]?.groupId ?? '']?.status).toBe(
      'invalidated',
    )
  })

  test('whole-stage runs retry the whole run in the same group', () => {
    const workbench = createWorkbench({
      initialState: buildFixture('failed', () => new Date()),
    })
    const failed = lastTaskId(workbench)
    expect(workbench.getState().tasks[failed]?.status).toBe('failed')
    const group =
      workbench.getState().runGroups[
        workbench.getState().tasks[failed]?.groupId ?? ''
      ]!
    expect(retryScope(group)).toBe('Retry the whole run')
    workbench.execute({ type: 'job.retry', input: { taskId: failed } })
    finishJobNow(workbench, lastTaskId(workbench))
    expect(states(workbench)[S.gridModeling]).toBe('executed')
  })

  test('retry explains published and legacy jobs', () => {
    const workbench = setup()
    const done = lastTaskId(workbench)
    expect(retryBlocker(workbench.getState(), done)).toMatch(/already finished/)
    const state = workbench.getState()
    const legacy = {
      ...state,
      tasks: {
        ...state.tasks,
        [done]: { ...state.tasks[done]!, groupId: null },
      },
    }
    expect(retryBlocker(legacy, done)).toMatch(/before retries/)
  })
})
