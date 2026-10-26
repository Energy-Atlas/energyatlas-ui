import { describe, expect, it } from 'vitest'
import { createTestProject } from '../../testing/testProject.ts'
import { DEFAULT_CONDITIONS } from '../../server/conditions.ts'
import { STAGE_IDS } from '../../domain/workflow.ts'
import { createProjectLifecycle } from './projectLifecycle.ts'
import { memoryStorage } from '../../testing/memoryStorage.ts'
import { executeToolCall, requiresApproval } from '../agent/tools.ts'
import { createLayoutController } from '../layout/layoutController.ts'
import { createViewStore } from '../view/viewStore.ts'

describe('shared project lifecycle', () => {
  it('agent project tools use the same guard and report Stay as a declined transition', async () => {
    const project = createTestProject({
      fixture: 'partway',
      storage: memoryStorage(),
    })
    const lifecycle = createProjectLifecycle(project)
    const deps = {
      ...project,
      lifecycle,
      layout: createLayoutController(project.workbench, null),
      view: createViewStore(project.workbench),
    }
    const call = { kind: 'project', intent: { type: 'close' } } as const
    expect(requiresApproval(call)).toBe(true)
    const result = executeToolCall(deps, call)
    expect(lifecycle.store.getState().guard?.type).toBe('close')
    lifecycle.stay()
    expect(await result).toMatchObject({
      status: 'rejected',
      issues: [{ message: 'Cancelled. The current project remains open.' }],
    })
    expect(project.server.current().state).not.toBeNull()
    const listing = executeToolCall(deps, {
      kind: 'project',
      intent: { type: 'list' },
    })
    await project.manual.settle()
    expect(await listing).toMatchObject({
      status: 'applied',
      data: { projects: [] },
    })
  })
  it('rejects new draft changes while a confirmed session transition waits', async () => {
    const project = createTestProject({
      fixture: 'partway',
      storage: memoryStorage(),
    })
    const saved = project.client.save()
    await project.manual.settle()
    await saved
    const lifecycle = createProjectLifecycle(project)
    project.client.setConditions({
      ...DEFAULT_CONDITIONS,
      latency: 'none',
      hold: true,
    })
    const closing = lifecycle.request({ type: 'close' })
    const id = project.workbench.getState().buildingIds[0] ?? ''
    const edit = await project.client.execute({
      type: 'edits.propose',
      input: { entityId: id, field: 'floors', value: 60 },
    })
    expect(edit.outcome.status).toBe('rejected')
    expect(project.workbench.undo().outcome.status).toBe('rejected')
    project.client.setConditions({ ...DEFAULT_CONDITIONS, latency: 'none' })
    await project.manual.settle()
    expect((await closing).outcome.status).toBe('applied')
  })
  it('validates a new name before asking to leave or cancelling jobs', async () => {
    const project = createTestProject({ fixture: 'partway' })
    const lifecycle = createProjectLifecycle(project)
    lifecycle.openCreate()
    const result = await lifecycle.request({ type: 'create', name: ' ' })
    expect(result.outcome).toMatchObject({
      status: 'rejected',
      issues: [{ path: 'name' }],
    })
    expect(lifecycle.store.getState().guard).toBeNull()
    expect(lifecycle.store.getState().dialog).toBe('create')
  })
  it('Stay preserves drafts and the open project', async () => {
    const project = createTestProject({ fixture: 'partway' })
    const lifecycle = createProjectLifecycle(project)
    const id = project.workbench.getState().buildingIds[0] ?? ''
    await project.client.execute({
      type: 'edits.propose',
      input: { entityId: id, field: 'floors', value: 60 },
    })
    const before = project.workbench.getState()
    const leaving = lifecycle.request({ type: 'close' })
    expect(lifecycle.store.getState().guard?.type).toBe('close')
    lifecycle.stay()
    expect((await leaving).outcome.status).toBe('rejected')
    expect(project.workbench.getState()).toBe(before)
  })
  it('confirms cancellation on leaving, but Stay keeps jobs running', async () => {
    const project = createTestProject({ conditions: { jobs: 'stall' } })
    const lifecycle = createProjectLifecycle(project)
    void project.client.execute({
      type: 'workflow.runStage',
      input: { stageId: STAGE_IDS.location },
    })
    await project.manual.settle(20)
    const leaving = lifecycle.request({ type: 'close' })
    lifecycle.stay()
    await leaving
    expect(
      Object.values(project.server.current().state?.tasks ?? {})[0]?.status,
    ).toBe('running')
    const second = lifecycle.request({ type: 'close' })
    const confirmed = lifecycle.confirm('discard')
    await project.manual.settle(200)
    expect((await confirmed)?.outcome.status).toBe('applied')
    expect((await second).outcome.status).toBe('applied')
    expect(project.server.current().state).toBeNull()
  })
  it('a failed Save prevents leaving and offers retry or Stay', async () => {
    const project = createTestProject({ fixture: 'partway' })
    const lifecycle = createProjectLifecycle(project)
    const leaving = lifecycle.request({ type: 'close' })
    project.client.setConditions({
      ...DEFAULT_CONDITIONS,
      latency: 'none',
      fault: 'everyRequest',
    })
    const saving = lifecycle.confirm('save')
    await project.manual.settle()
    expect((await saving)?.outcome.status).toBe('rejected')
    expect(project.server.current().state).not.toBeNull()
    expect(lifecycle.store.getState().guard?.type).toBe('close')
    expect(lifecycle.store.getState().issues.length).toBeGreaterThan(0)
    lifecycle.stay()
    await leaving
  })
})
