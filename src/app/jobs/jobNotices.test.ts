import { describe, expect, it } from 'vitest'
import { STAGE_IDS } from '../../domain/workflow.ts'
import { DEFAULT_CONDITIONS } from '../../server/conditions.ts'
import { createTestProject } from '../../testing/testProject.ts'
import { createViewStore } from '../view/viewStore.ts'
import { listJobs, shownJob } from '../pages/jobs/jobView.ts'
import { createJobNotices } from './jobNotices.ts'
import { createWorkbench } from '../../domain/workbench.ts'
import { buildFixture } from '../../server/fixtures.ts'

describe('job notices', () => {
  it('announces a partial failure once, naming held results', async () => {
    const project = createTestProject({ fixture: 'partway' })
    const notices = createJobNotices(project.workbench)
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
    const [latest, previous] = notices.store.getState().notices
    expect(latest).toMatchObject({ tone: 'warning' })
    expect(latest?.message).toMatch(/partly failed.*held/)
    expect(previous?.message).toMatch(/Schema matching completed/)
    notices.dismiss(latest?.id ?? '')
    expect(notices.store.getState().notices).toHaveLength(1)
    notices.dispose()
  })

  it('never carries notices or old jobs into another project', async () => {
    const project = createTestProject({ fixture: 'new' })
    project.client.setConditions({
      ...DEFAULT_CONDITIONS,
      latency: 'none',
      jobs: 'stall',
    })
    const notices = createJobNotices(project.workbench)
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
    expect(notices.store.getState().notices).toEqual([])
    notices.dispose()
  })
})

describe('job notice baseline', () => {
  it('ignores a job of the same id finishing in a different project', () => {
    const workbench = createWorkbench()
    workbench.execute({
      type: 'workflow.runStage',
      input: { stageId: STAGE_IDS.location },
    })
    const notices = createJobNotices(workbench)
    const other = buildFixture('complete', () => new Date())
    other.project = { ...other.project, id: 'project:other' }
    const taskId = workbench.getState().taskIds.at(-1) ?? ''
    expect(other.tasks[taskId]?.status).toBe('succeeded')
    workbench.load(other, { type: 'project.open', title: 'Open', summary: '' })
    expect(notices.store.getState().notices).toEqual([])
    notices.dispose()
  })

  it('clears notices when the project session generation changes', () => {
    const workbench = createWorkbench()
    workbench.execute({
      type: 'workflow.runStage',
      input: { stageId: STAGE_IDS.location },
    })
    let generation = 0
    const listeners = new Set<() => void>()
    const notices = createJobNotices(workbench, {
      getGeneration: () => generation,
      subscribe: (listener) => {
        listeners.add(listener)
        return () => listeners.delete(listener)
      },
    })
    const taskId = workbench.getState().taskIds.at(-1) ?? ''
    workbench.execute({ type: 'task.start', input: { taskId } }, 'system')
    workbench.execute({ type: 'task.complete', input: { taskId } }, 'system')
    expect(notices.store.getState().notices).toHaveLength(1)
    generation = 1
    for (const listener of listeners) listener()
    expect(notices.store.getState().notices).toEqual([])
    notices.dispose()
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
