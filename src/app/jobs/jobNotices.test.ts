import { describe, expect, it } from 'vitest'
import { STAGE_IDS } from '../../domain/workflow.ts'
import { DEFAULT_CONDITIONS } from '../../server/conditions.ts'
import { createTestProject } from '../../testing/testProject.ts'
import { createViewStore } from '../view/viewStore.ts'
import { listJobs, shownJob } from '../pages/jobs/jobView.ts'
import {
  createMessageCenter,
  type MessageCenter,
} from '../messages/messageCenter.ts'
import { createWorkbench } from '../../domain/workbench.ts'
import { buildFixture } from '../../server/fixtures.ts'

/** Job messages, newest first. */
function jobMessages(center: MessageCenter) {
  return center.store
    .getState()
    .messages.filter((message) => message.source === 'job')
    .toReversed()
}

/** Job messages still showing as toasts. */
function jobToasts(center: MessageCenter) {
  const { toasts } = center.store.getState()
  return jobMessages(center).filter((message) => toasts.includes(message.id))
}

describe('job notices', () => {
  it('announces a partial failure once, naming held results', async () => {
    const project = createTestProject({ fixture: 'partway' })
    const center = createMessageCenter({ workbench: project.workbench })
    const schema = project.client.execute({
      type: 'workflow.runStage',
      input: { stageId: STAGE_IDS.schema },
    })
    await project.manual.settle()
    await schema
    project.client.setConditions({
      ...DEFAULT_CONDITIONS,
      latency: 'none',
      jobs: 'itemFailures',
    })
    const run = project.client.execute({
      type: 'workflow.runStage',
      input: { stageId: STAGE_IDS.preprocessing },
    })
    await project.manual.settle()
    await run
    const [latest, previous, ...rest] = jobMessages(center)
    expect(rest).toEqual([])
    expect(latest).toMatchObject({ tone: 'warning', toast: true, read: false })
    expect(latest?.text).toMatch(/partly failed.*held/)
    expect(latest?.actions[0]).toMatchObject({
      kind: 'openJob',
      label: 'Open job',
    })
    expect(previous?.text).toMatch(/Schema matching completed/)
    center.dismissToast(latest?.id ?? '')
    expect(jobToasts(center)).toHaveLength(1)
    expect(jobMessages(center)[0]?.read).toBe(true)
    center.dispose()
  })

  it('never carries toasts or old jobs into another project', async () => {
    const project = createTestProject({ fixture: 'new' })
    project.client.setConditions({
      ...DEFAULT_CONDITIONS,
      latency: 'none',
      jobs: 'stall',
    })
    const center = createMessageCenter({
      workbench: project.workbench,
      session: {
        getGeneration: () => project.client.store.getState().projectGeneration,
        subscribe: (listener) => project.client.store.subscribe(listener),
      },
    })
    void project.client.execute({
      type: 'workflow.runStage',
      input: { stageId: STAGE_IDS.location },
    })
    await project.manual.settle(5)
    const replaced = project.client.withTransition(async (execute) => {
      const taskId = project.workbench.getState().taskIds.at(-1) ?? ''
      await execute({ type: 'task.cancel', input: { taskId } })
      return project.client.replaceProject('complete')
    })
    await project.manual.settle(50)
    await replaced
    expect(jobToasts(center)).toEqual([])
    center.dispose()
  })
})

describe('job notice baseline', () => {
  it('ignores a job of the same id finishing in a different project', () => {
    const workbench = createWorkbench()
    workbench.execute({
      type: 'workflow.runStage',
      input: { stageId: STAGE_IDS.location },
    })
    const center = createMessageCenter({ workbench })
    const other = buildFixture('complete', () => new Date())
    other.project = { ...other.project, id: 'project:other' }
    const taskId = workbench.getState().taskIds.at(-1) ?? ''
    expect(other.tasks[taskId]?.status).toBe('succeeded')
    workbench.load(other, { type: 'project.open', title: 'Open', summary: '' })
    expect(jobMessages(center)).toEqual([])
    center.dispose()
  })

  it('takes toasts off the screen when the project session generation changes', () => {
    const workbench = createWorkbench()
    workbench.execute({
      type: 'workflow.runStage',
      input: { stageId: STAGE_IDS.location },
    })
    let generation = 0
    const listeners = new Set<() => void>()
    const center = createMessageCenter({
      workbench,
      session: {
        getGeneration: () => generation,
        subscribe: (listener) => {
          listeners.add(listener)
          return () => listeners.delete(listener)
        },
      },
    })
    const taskId = workbench.getState().taskIds.at(-1) ?? ''
    workbench.execute({ type: 'task.start', input: { taskId } }, 'system')
    workbench.execute({ type: 'task.complete', input: { taskId } }, 'system')
    expect(jobToasts(center)).toHaveLength(1)
    generation = 1
    for (const listener of listeners) listener()
    expect(jobToasts(center)).toEqual([])
    // The history keeps it, scoped to its project.
    expect(jobMessages(center)).toHaveLength(1)
    center.dispose()
  })
})

describe('job view operations', () => {
  it('select a known job, reject an unknown one, and filter the list', () => {
    const project = createTestProject({ fixture: 'failed' })
    const view = createViewStore(project.workbench)
    const state = project.workbench.getState()
    const failed = state.taskIds.at(-1) ?? ''
    expect(
      view.execute({ type: 'jobs.select', input: { taskId: 'task-0' } })
        .outcome,
    ).toMatchObject({ status: 'rejected', issues: [{ path: 'taskId' }] })
    expect(
      view.execute({ type: 'jobs.select', input: { taskId: failed } }).outcome
        .status,
    ).toBe('applied')
    view.execute({ type: 'jobs.setFilter', input: { filter: 'attention' } })
    expect(listJobs(state, 'attention').map((task) => task.id)).toEqual([
      failed,
    ])
    expect(listJobs(state, 'active')).toEqual([])
    expect(shownJob(state, null, 'all')?.id).toBe(failed)
    // Selecting a job is view state, never a project change.
    expect(project.workbench.getState()).toBe(state)
  })
})
