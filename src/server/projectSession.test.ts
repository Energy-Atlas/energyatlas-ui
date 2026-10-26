import { describe, expect, it } from 'vitest'
import { createTestProject } from '../testing/testProject.ts'
import { memoryStorage } from '../testing/memoryStorage.ts'
import { saveProject } from './persistence.ts'
import { createInitialState } from '../domain/initialState.ts'
import { DEFAULT_CONDITIONS } from './conditions.ts'

describe('project sessions', () => {
  it('clears a previous Save error when opening a saved session', async () => {
    const project = createTestProject({ storage: memoryStorage() })
    const saved = project.client.save()
    await project.manual.settle()
    await saved
    const id = project.server.current().state?.project.id ?? ''
    project.client.setConditions({
      ...DEFAULT_CONDITIONS,
      latency: 'none',
      fault: 'everyRequest',
    })
    const failed = project.client.save()
    await project.manual.settle()
    await failed
    expect(project.client.store.getState().saveError).toBeTruthy()
    project.client.setConditions({ ...DEFAULT_CONDITIONS, latency: 'none' })
    const opened = project.client.openProject(id)
    await project.manual.settle()
    expect((await opened).outcome.status).toBe('applied')
    expect(project.client.store.getState().saveError).toBeNull()
  })
  it('saving a startup fixture never overwrites the migrated legacy project', async () => {
    const storage = memoryStorage()
    saveProject(storage, createInitialState(), new Date())
    const project = createTestProject({ storage, fixture: 'partway' })
    const saving = project.client.save()
    await project.manual.settle()
    expect((await saving).outcome.status).toBe('applied')
    expect(project.client.store.getState().meta.projects).toHaveLength(2)
  })
  it('starts closed and refuses model commands until a project is created', async () => {
    const { client, server, manual } = createTestProject({ startClosed: true })
    expect(server.current().state).toBeNull()
    const refused = client.execute({
      type: 'workflow.runStage',
      input: { stageId: 'location' },
    })
    await manual.settle()
    expect((await refused).outcome.status).toBe('rejected')
    const invalid = client.createProject('  ')
    await manual.settle()
    expect((await invalid).outcome).toMatchObject({
      status: 'rejected',
      issues: [{ path: 'name' }],
    })
    const created = client.createProject('District A')
    await manual.settle()
    expect((await created).outcome.status).toBe('applied')
    expect(server.current().state?.project.name).toBe('District A')
    expect(client.store.getState().meta.currentProject?.name).toBe('District A')
  })
  it('keeps an open project after another project fails to open', async () => {
    const { client, server, manual } = createTestProject()
    const before = server.current().state?.project.id
    const opening = client.openProject('missing')
    await manual.settle()
    expect((await opening).outcome.status).toBe('rejected')
    expect(server.current().state?.project.id).toBe(before)
  })
})
