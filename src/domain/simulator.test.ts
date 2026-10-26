import { describe, expect, test } from 'vitest'
import { runStageNow } from './jobs/runNow.ts'
import {
  startTaskSimulator,
  type JobBehaviour,
  type Scheduler,
} from './simulator.ts'
import { createWorkbench } from './workbench.ts'
import { STAGE_IDS, deriveStageStates } from './workflow.ts'

function createManualScheduler() {
  const queue: { callback: () => void; cancelled: boolean }[] = []
  const scheduler: Scheduler = {
    schedule(callback) {
      const job = { callback, cancelled: false }
      queue.push(job)
      return () => {
        job.cancelled = true
      }
    },
  }
  const runNext = () => {
    const job = queue.shift()
    if (job && !job.cancelled) job.callback()
  }
  const runAll = (limit = 100) => {
    for (let count = 0; queue.length > 0 && count < limit; count++) runNext()
  }
  const pending = () => queue.filter((job) => !job.cancelled).length
  return { scheduler, runNext, runAll, pending }
}

describe('startTaskSimulator', () => {
  test('advances a queued stage task through progress to completion', () => {
    const workbench = createWorkbench()
    const manual = createManualScheduler()
    const stop = startTaskSimulator(workbench, {
      scheduler: manual.scheduler,
      steps: 4,
    })

    workbench.execute({
      type: 'workflow.runStage',
      input: { stageId: STAGE_IDS.location },
    })
    expect(manual.pending()).toBe(1)
    manual.runAll()

    const state = workbench.getState()
    const task = Object.values(state.tasks)[0]
    expect(task).toMatchObject({ status: 'succeeded', progress: 1 })
    expect(
      deriveStageStates(state.workflow, state.tasks)[STAGE_IDS.location],
    ).toBe('executed')
    const systemTypes = workbench.store
      .getState()
      .log.filter((entry) => entry.source === 'system')
      .map((entry) => entry.type)
    expect(systemTypes).toEqual([
      'task.start',
      'task.reportProgress',
      'task.reportProgress',
      'task.reportProgress',
      'task.complete',
    ])
    stop()
  })

  test('stops advancing a task once it is cancelled', () => {
    const workbench = createWorkbench()
    const manual = createManualScheduler()
    const stop = startTaskSimulator(workbench, {
      scheduler: manual.scheduler,
      steps: 4,
    })

    workbench.execute({
      type: 'workflow.runStage',
      input: { stageId: STAGE_IDS.location },
    })
    manual.runNext()
    const taskId = workbench.getState().taskIds[0] ?? ''
    expect(workbench.getState().tasks[taskId]?.status).toBe('running')

    workbench.execute({ type: 'task.cancel', input: { taskId } })
    manual.runAll()

    expect(workbench.getState().tasks[taskId]?.status).toBe('cancelled')
    expect(
      workbench.store
        .getState()
        .log.some((entry) => entry.type === 'task.complete'),
    ).toBe(false)
    stop()
  })

  test('runs one job at a time in the order submitted', () => {
    const workbench = createWorkbench()
    runStageNow(workbench, STAGE_IDS.location)
    const manual = createManualScheduler()
    const stop = startTaskSimulator(workbench, {
      scheduler: manual.scheduler,
      steps: 2,
    })
    // Two independent runs queued together.
    workbench.execute({
      type: 'workflow.runStage',
      input: { stageId: STAGE_IDS.enrichment },
    })
    workbench.execute({
      type: 'workflow.runStage',
      input: { stageId: STAGE_IDS.location },
    })
    const [, first, second] = workbench.getState().taskIds
    manual.runNext()
    const running = () =>
      Object.values(workbench.getState().tasks).filter(
        (task) => task.status === 'running',
      )
    expect(running().map((task) => task.id)).toEqual([first])
    expect(workbench.getState().tasks[second ?? '']?.status).toBe('queued')
    manual.runAll()
    const order = workbench.store
      .getState()
      .log.filter((entry) => entry.type === 'task.start')
      .map((entry) => (entry.input as { taskId: string }).taskId)
    expect(order.slice(-2)).toEqual([first, second])
    stop()
  })

  test('fails some items transiently, then retries only those', () => {
    const workbench = createWorkbench()
    for (const stageId of [
      STAGE_IDS.location,
      STAGE_IDS.enrichment,
      STAGE_IDS.schema,
    ]) {
      runStageNow(workbench, stageId)
    }
    const manual = createManualScheduler()
    const stop = startTaskSimulator(workbench, {
      scheduler: manual.scheduler,
      behaviour: () => 'itemFailures',
    })
    workbench.execute({
      type: 'workflow.runStage',
      input: { stageId: STAGE_IDS.preprocessing },
    })
    manual.runAll()
    const failed = workbench.getState().taskIds.at(-1) ?? ''
    const task = workbench.getState().tasks[failed]
    expect(task?.status).toBe('failed')
    const failures = Object.keys(task?.items?.failures ?? {})
    expect(failures.length).toBeGreaterThan(0)
    expect(
      workbench.store
        .getState()
        .log.filter((entry) => entry.type === 'task.processItems'),
    ).toHaveLength(4)

    workbench.execute({ type: 'job.retry', input: { taskId: failed } })
    manual.runAll()
    const retry =
      workbench.getState().tasks[workbench.getState().taskIds.at(-1) ?? '']
    expect(retry).toMatchObject({ status: 'succeeded', attempt: 2 })
    expect(retry?.items?.ids).toEqual(failures)
    stop()
  })

  test('keeps results held when publication fails', () => {
    const workbench = createWorkbench()
    for (const stageId of [
      STAGE_IDS.location,
      STAGE_IDS.enrichment,
      STAGE_IDS.schema,
    ]) {
      runStageNow(workbench, stageId)
    }
    const manual = createManualScheduler()
    let mode: JobBehaviour = 'publishFails'
    const stop = startTaskSimulator(workbench, {
      scheduler: manual.scheduler,
      behaviour: () => mode,
    })
    workbench.execute({
      type: 'workflow.runStage',
      input: { stageId: STAGE_IDS.preprocessing },
    })
    manual.runAll()
    const failed = workbench.getState().taskIds.at(-1) ?? ''
    expect(workbench.getState().tasks[failed]?.message).toMatch(
      /Publication failed/,
    )
    mode = 'normal'
    workbench.execute({ type: 'job.retry', input: { taskId: failed } })
    manual.runAll()
    expect(workbench.getState().buildings.B0001?.heightM).not.toBeNull()
    stop()
  })
})
