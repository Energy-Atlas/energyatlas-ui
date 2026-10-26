import { describe, expect, it } from 'vitest'
import { STAGE_IDS } from '../domain/workflow.ts'
import type { JobBehaviour } from '../domain/simulator.ts'
import { createTestProject } from '../testing/testProject.ts'
import { DEFAULT_CONDITIONS } from './conditions.ts'

const preprocess = {
  type: 'workflow.runStage',
  input: { stageId: STAGE_IDS.preprocessing },
} as const

/** The partway fixture with Schema matching rerun, so preprocessing is ready again. */
async function readyForPreprocessing(jobs: JobBehaviour = 'normal') {
  const project = createTestProject({ fixture: 'partway' })
  const schema = project.client.execute({
    type: 'workflow.runStage',
    input: { stageId: STAGE_IDS.schema },
  })
  await project.manual.settle()
  await schema
  project.client.setConditions({ ...DEFAULT_CONDITIONS, latency: 'none', jobs })
  return project
}

describe('jobs on the mock server', () => {
  it('holds item results, retries failed items, and publishes once through the client', async () => {
    const { client, manual, workbench, server } =
      await readyForPreprocessing('itemFailures')
    const heightsBefore = workbench.getState().buildings.B0001?.heightM
    const run = client.execute(preprocess)
    await manual.settle()
    expect((await run).outcome.status).toBe('applied')
    const failed = workbench.getState().taskIds.at(-1) ?? ''
    expect(workbench.getState().tasks[failed]?.status).toBe('failed')
    // Earlier published outputs stay as they were while new ones are held.
    expect(workbench.getState().buildings.B0001?.heightM).toBe(heightsBefore)

    const retry = client.execute({
      type: 'job.retry',
      input: { taskId: failed },
    })
    await manual.settle()
    expect((await retry).outcome.status).toBe('applied')
    const state = server.current().state!
    const latest = state.tasks[state.taskIds.at(-1) ?? '']
    expect(latest).toMatchObject({ status: 'succeeded', attempt: 2 })
    expect(state.runGroups[latest?.groupId ?? '']?.status).toBe('published')
  })

  it('keeps the edit lock while jobs are queued and releases it after a partial failure', async () => {
    const { client, manual } = await readyForPreprocessing('stall')
    void client.execute(preprocess)
    await manual.settle(20)
    const locked = client.execute({
      type: 'measure.create',
      input: {
        name: 'Lights',
        kind: 'lighting',
        savingsPercent: 10,
        appliesTo: 'all',
      },
    })
    await manual.settle(20)
    expect((await locked).outcome.status).toBe('rejected')
    client.setConditions({
      ...DEFAULT_CONDITIONS,
      latency: 'none',
      jobs: 'itemFailures',
    })
    await manual.settle()
    const unlocked = client.execute({
      type: 'measure.create',
      input: {
        name: 'Lights',
        kind: 'lighting',
        savingsPercent: 10,
        appliesTo: 'all',
      },
    })
    await manual.settle()
    expect((await unlocked).outcome.status).toBe('applied')
  })

  it('gives each submission a key so a repeated delivery queues nothing new', async () => {
    const { server, manual } = await readyForPreprocessing('stall')
    const command = {
      type: 'command' as const,
      command: {
        type: 'workflow.runStage' as const,
        input: { stageId: STAGE_IDS.preprocessing, requestId: 'same' },
      },
      source: 'manual' as const,
    }
    expect(server.handle(command).ok).toBe(true)
    const count = server.current().state?.taskIds.length
    expect(server.handle(command).ok).toBe(true)
    expect(server.current().state?.taskIds.length).toBe(count)
    await manual.flush()
  })

  it('resolves cancellation racing completion consistently', async () => {
    const { client, manual, workbench } = await readyForPreprocessing()
    void client.execute(preprocess)
    await manual.settle()
    const taskId = workbench.getState().taskIds.at(-1) ?? ''
    expect(workbench.getState().tasks[taskId]?.status).toBe('succeeded')
    const late = client.execute({ type: 'task.cancel', input: { taskId } })
    await manual.settle()
    const result = await late
    expect(result.outcome).toMatchObject({
      status: 'rejected',
      issues: [{ message: 'The job is already completed.' }],
    })
    expect(workbench.getState().tasks[taskId]?.status).toBe('succeeded')
  })

  it('runs queued jobs in submission order on the server', async () => {
    const { client, manual, server } = await readyForPreprocessing()
    void client.execute(preprocess)
    void client.execute({
      type: 'workflow.runStage',
      input: { stageId: STAGE_IDS.location },
    })
    await manual.settle(3)
    const state = server.current().state!
    const active = state.taskIds
      .map((id) => state.tasks[id]!)
      .filter((task) => task.status === 'queued' || task.status === 'running')
    expect(active.map((task) => task.stageId)).toEqual([
      STAGE_IDS.preprocessing,
      STAGE_IDS.location,
    ])
    expect(
      active.filter((task) => task.status === 'running').length,
    ).toBeLessThanOrEqual(1)
    await manual.settle()
  })
})
