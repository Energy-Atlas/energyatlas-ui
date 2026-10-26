import { describe, expect, it } from 'vitest'
import { PARTWAY_FAILURE } from '../../domain/simulator.ts'
import { STAGE_IDS, deriveStageStates } from '../../domain/workflow.ts'
import {
  DEFAULT_CONDITIONS,
  initialConditions,
} from '../../server/conditions.ts'
import { OFFLINE_MESSAGE } from '../../server/transport.ts'
import { createTestProject } from '../../testing/testProject.ts'

function memoryStorage(): Storage {
  const values = new Map<string, string>()
  return {
    get length() {
      return values.size
    },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => void values.delete(key),
    setItem: (key, value) => void values.set(key, value),
  }
}

const runLocation = {
  type: 'workflow.runStage',
  input: { stageId: STAGE_IDS.location },
} as const

describe('project client and mock server', () => {
  it('runs local commands at once and server commands after the reply', async () => {
    const { client, workbench, manual } = createTestProject({
      fixture: 'partway',
    })
    const buildingId = workbench.getState().buildingIds[0] ?? ''
    await client.execute({
      type: 'selection.set',
      input: { entityType: 'building', ids: [buildingId] },
    })
    expect(workbench.getState().selection.ids).toEqual([buildingId])

    const sent = client.execute({
      type: 'workflow.setStageSkipped',
      input: { stageId: STAGE_IDS.shading, skipped: true },
    })
    expect(client.store.getState().pending.map((r) => r.type)).toEqual([
      'workflow.setStageSkipped',
    ])
    await manual.settle()
    const result = await sent
    expect(result.outcome.status).toBe('applied')
    expect(client.store.getState().pending).toEqual([])
    expect(
      workbench.getState().workflow.stages[STAGE_IDS.shading]?.skipped,
    ).toBe(true)
    // The server's update kept the UI's own selection.
    expect(workbench.getState().selection.ids).toEqual([buildingId])
    expect(client.store.getState().meta.dirty).toBe(true)
  })

  it('refuses server commands sent straight to the UI workbench', () => {
    const { workbench } = createTestProject()
    const { outcome } = workbench.execute(runLocation)
    expect(outcome.status).toBe('rejected')
    expect(workbench.getState().taskIds).toEqual([])
  })

  it('runs a stage as a job with a log, and focuses it', async () => {
    const { client, workbench, manual } = createTestProject()
    const sent = client.execute(runLocation)
    await manual.settle(200)
    expect((await sent).outcome.status).toBe('applied')
    const state = workbench.getState()
    const task = state.tasks[state.taskIds[0] ?? '']
    expect(task?.status).toBe('succeeded')
    expect(task?.log.map((line) => line.message)).toEqual([
      'Queued.',
      'Started.',
      '25% complete.',
      '50% complete.',
      '75% complete.',
      expect.stringMatching(/^Completed\./),
    ])
    expect(state.workflow.currentStageId).toBe(STAGE_IDS.location)
  })

  it('refuses edits while a run holds the project, as RC does', async () => {
    const { client, manual } = createTestProject({ fixture: 'partway' })
    void client.execute({
      type: 'workflow.runStage',
      input: { stageId: STAGE_IDS.shading },
    })
    await manual.flush()
    manual.runNext()
    await manual.flush()
    const refused = client.execute({
      type: 'measure.create',
      input: {
        name: 'Heat pumps',
        kind: 'heating',
        savingsPercent: 30,
        appliesTo: 'all',
      },
    })
    await manual.settle(200)
    const result = await refused
    expect(result.outcome.status).toBe('rejected')
    if (result.outcome.status === 'rejected') {
      expect(result.outcome.issues[0]?.message).toMatch(/A run is in progress/)
    }
  })

  it('shows rejected input on the field the server names', async () => {
    const { client, manual } = createTestProject({
      conditions: { fault: 'rejectInput' },
    })
    const sent = client.execute({
      type: 'measure.create',
      input: {
        name: 'Heat pumps',
        kind: 'heating',
        savingsPercent: 30,
        appliesTo: 'all',
      },
    })
    await manual.settle()
    const result = await sent
    expect(result.outcome).toMatchObject({
      status: 'rejected',
      issues: [{ path: 'name' }],
    })
  })

  it('fails the next request once, then answers normally', async () => {
    const { client, manual } = createTestProject({
      conditions: { fault: 'nextRequest' },
    })
    const first = client.execute(runLocation)
    await manual.settle()
    expect((await first).outcome.status).toBe('rejected')
    expect(client.store.getState().conditions.fault).toBe('none')
    const second = client.execute(runLocation)
    await manual.settle(200)
    expect((await second).outcome.status).toBe('applied')
  })

  it('sends nothing while offline and catches up when back online', async () => {
    const { client, workbench, manual, server } = createTestProject()
    client.setConditions({ ...DEFAULT_CONDITIONS, fault: 'offline' })
    const sent = client.execute(runLocation)
    await manual.settle()
    const result = await sent
    expect(result.outcome).toMatchObject({
      status: 'rejected',
      issues: [{ message: OFFLINE_MESSAGE }],
    })

    // A change made on the server meanwhile is missed, then caught up.
    server.handle({ type: 'command', command: runLocation, source: 'system' })
    await manual.settle(200)
    expect(workbench.getState().taskIds).toEqual([])
    client.setConditions({ ...DEFAULT_CONDITIONS, latency: 'none' })
    await manual.settle()
    expect(workbench.getState().taskIds).toHaveLength(1)
    expect(workbench.store.getState().log.at(-1)?.type).toBe('service.resync')
  })

  it('holds requests unanswered until hold is turned off', async () => {
    const { client, manual } = createTestProject({ conditions: { hold: true } })
    let answered = false
    const sent = client.execute(runLocation).then((result) => {
      answered = true
      return result
    })
    await manual.settle()
    expect(answered).toBe(false)
    expect(client.store.getState().pending).toHaveLength(1)
    client.setConditions({ ...DEFAULT_CONDITIONS, latency: 'none' })
    await manual.settle(200)
    expect((await sent).outcome.status).toBe('applied')
  })

  it('fails jobs partway and stalls them as demo conditions', async () => {
    const failing = createTestProject({ conditions: { jobs: 'failPartway' } })
    void failing.client.execute(runLocation)
    await failing.manual.settle(200)
    const failed = failing.workbench.getState()
    expect(failed.tasks[failed.taskIds[0] ?? '']?.message).toBe(PARTWAY_FAILURE)
    expect(
      deriveStageStates(failed.workflow, failed.tasks)[STAGE_IDS.location],
    ).toBe('failed')

    const stalling = createTestProject({ conditions: { jobs: 'stall' } })
    void stalling.client.execute(runLocation)
    await stalling.manual.settle(50)
    const stalled = stalling.workbench.getState()
    const task = stalled.tasks[stalled.taskIds[0] ?? '']
    expect(task?.status).toBe('running')
    expect(task?.progress).toBe(0)
  })

  it('undoes drafts only, and forgets them once they are applied', async () => {
    const { client, workbench, manual } = createTestProject({
      fixture: 'partway',
    })
    const buildingId = workbench.getState().buildingIds[0] ?? ''
    await client.execute({
      type: 'edits.propose',
      input: { entityId: buildingId, field: 'floors', value: 9 },
    })
    expect(workbench.store.getState().canUndo).toBe(true)
    workbench.undo()
    expect(workbench.getState().pendingEdits).toEqual({})
    workbench.redo()
    expect(Object.keys(workbench.getState().pendingEdits)).toHaveLength(1)

    const sent = client.execute({ type: 'edits.apply', input: {} })
    await manual.settle()
    expect((await sent).outcome.status).toBe('applied')
    expect(workbench.getState().pendingEdits).toEqual({})
    expect(workbench.getState().buildings[buildingId]?.floors).toBe(9)
    expect(workbench.store.getState().canUndo).toBe(false)
  })

  it('saves to this browser and restores on the next start', async () => {
    const storage = memoryStorage()
    const first = createTestProject({ storage })
    void first.client.execute(runLocation)
    await first.manual.settle(200)
    const saved = first.client.save()
    await first.manual.settle()
    expect((await saved).outcome.status).toBe('applied')
    expect(first.client.store.getState().meta).toMatchObject({ dirty: false })

    const second = createTestProject({ storage })
    expect(second.workbench.getState().buildingIds.length).toBeGreaterThan(0)
    expect(second.client.store.getState().meta.savedAt).not.toBeNull()
  })

  it('replaces the project with a fixture and drops local selection and drafts', async () => {
    const { client, workbench, manual } = createTestProject({
      fixture: 'partway',
    })
    const buildingId = workbench.getState().buildingIds[0] ?? ''
    await client.execute({
      type: 'selection.set',
      input: { entityType: 'building', ids: [buildingId] },
    })
    const sent = client.replaceProject('new')
    await manual.settle()
    expect((await sent).outcome.status).toBe('applied')
    expect(workbench.getState().buildingIds).toEqual([])
    expect(workbench.getState().selection.ids).toEqual([])
  })
})

describe('demo conditions', () => {
  it('starts from the session, with URL parameters winning', () => {
    const session = memoryStorage()
    session.setItem(
      'eaui.demoConditions',
      JSON.stringify({ latency: 'slow', fault: 'offline' }),
    )
    const { conditions, fixture } = initialConditions(
      session,
      '?fault=editLock&jobs=stall&hold=1&fixture=complete&latency=bogus',
    )
    expect(conditions).toEqual({
      latency: 'slow',
      fault: 'editLock',
      jobs: 'stall',
      hold: true,
    })
    expect(fixture).toBe('complete')
    expect(initialConditions(null, '?fixture=nope').fixture).toBeNull()
  })
})
