import { describe, expect, test } from 'vitest'
import { memoryStorage } from '../testing/memoryStorage.ts'
import { createTestProject } from '../testing/testProject.ts'
import { createProjectLifecycle } from '../app/service/projectLifecycle.ts'
import { VIEW_ONLY_MESSAGE } from './apiError.ts'
import { CATALOG_KEY, readProjectCatalog } from './projectCatalog.ts'
import {
  PROJECT_FILE_FORMAT,
  projectFileName,
  readProjectFile,
} from './projectFile.ts'

// File > Save as… > Project (decision 0036): a copy kept as a new project in
// this browser and returned as a project file, which opens again elsewhere.

async function saveAs(name = 'Copy of the demo') {
  const storage = memoryStorage()
  const project = createTestProject({ storage, fixture: 'complete' })
  const lifecycle = createProjectLifecycle({
    workbench: project.workbench,
    client: project.client,
  })
  const saving = lifecycle.saveAs(name)
  await project.manual.settle()
  return { storage, project, lifecycle, saved: await saving }
}

describe('Save as project', () => {
  test('keeps a copy, unsaved changes included, as a new project and stays in the original', async () => {
    const { storage, project, saved } = await saveAs()
    expect(saved.result.outcome.status).toBe('applied')
    const file = saved.file!
    expect(file.format).toBe(PROJECT_FILE_FORMAT)
    expect(file.project.name).toBe('Copy of the demo')
    // A new id, and the copy's state carries the new name and id.
    const original = project.workbench.getState().project
    expect(file.project.id).not.toBe(original.id)
    expect(file.project.state.project).toMatchObject({
      id: file.project.id,
      name: 'Copy of the demo',
    })
    // The open project stays open and unchanged.
    expect(project.client.store.getState().meta.currentProject?.id).toBe(
      original.id,
    )
    // The copy is in this browser's catalog, and only the copy was saved.
    const { catalog } = readProjectCatalog(storage)
    expect(catalog.projects.map((entry) => entry.name)).toEqual([
      'Copy of the demo',
    ])
    expect(storage.getItem(CATALOG_KEY)).toContain(file.project.id)
    // The copy holds the model as it is now: buildings and results.
    expect(file.project.state.buildingIds.length).toBe(
      project.workbench.getState().buildingIds.length,
    )
    expect(file.project.state.results.baseline).not.toBeNull()
  })

  test('refuses an empty name at the field, and a viewer session refuses it', async () => {
    const { saved: refused } = await saveAs('  ')
    expect(refused.result.outcome).toMatchObject({
      status: 'rejected',
      issues: [{ path: 'name' }],
    })
    expect(refused.file).toBeNull()

    const viewer = createTestProject({ startClosed: true, mode: 'viewer' })
    const reply = await (async () => {
      const sent = viewer.client.saveProjectAs('Anything')
      await viewer.manual.settle()
      return sent
    })()
    expect(reply.result.outcome).toMatchObject({ status: 'rejected' })
    if (reply.result.outcome.status === 'rejected') {
      expect(reply.result.outcome.issues[0]?.message).toBe(VIEW_ONLY_MESSAGE)
    }
  })

  test('a project file opens again through the lifecycle, as a copy when this browser keeps it', async () => {
    const { storage, saved } = await saveAs()
    const text = JSON.stringify(saved.file)
    expect(readProjectFile(text)).toMatchObject({ ok: true })

    // Another browser: the file opens and is kept there.
    const elsewhere = memoryStorage()
    const other = createTestProject({ storage: elsewhere, startClosed: true })
    const otherLifecycle = createProjectLifecycle({
      workbench: other.workbench,
      client: other.client,
    })
    const opened = otherLifecycle.request({
      type: 'openFile',
      file: { name: 'copy.project.json', text },
    })
    await other.manual.settle()
    expect((await opened).outcome.status).toBe('applied')
    expect(other.workbench.getState().project.id).toBe(saved.file!.project.id)
    expect(readProjectCatalog(elsewhere).catalog.projects).toHaveLength(1)

    // This browser already keeps that project: it opens as a copy beside it.
    const same = createTestProject({ storage, startClosed: true })
    const sameLifecycle = createProjectLifecycle({
      workbench: same.workbench,
      client: same.client,
    })
    const again = sameLifecycle.request({
      type: 'openFile',
      file: { name: 'copy.project.json', text },
    })
    await same.manual.settle()
    expect((await again).outcome.status).toBe('applied')
    expect(same.workbench.getState().project.id).not.toBe(
      saved.file!.project.id,
    )
    expect(readProjectCatalog(storage).catalog.projects).toHaveLength(2)
  })

  test('refuses files that are not projects, with a reason each', () => {
    /** Why a file text is refused, or null when it is read. */
    const refusal = (text: string) => {
      const read = readProjectFile(text)
      return read.ok ? null : read.message
    }
    expect(refusal('{ not json')).toContain('not valid JSON')
    expect(
      refusal(JSON.stringify({ format: 'energyatlas-ui.handover' })),
    ).toContain('is a view')
    expect(refusal(JSON.stringify({ format: 'other' }))).toContain(
      'not an EnergyAtlas project',
    )
    expect(
      refusal(JSON.stringify({ format: PROJECT_FILE_FORMAT, version: 9 })),
    ).toContain('newer version')
    expect(
      refusal(
        JSON.stringify({
          format: PROJECT_FILE_FORMAT,
          version: 1,
          savedAt: '2026-10-29T00:00:00Z',
          project: { id: 'p', name: 'P', state: {} },
        }),
      ),
    ).toContain('damaged or incomplete')
    expect(projectFileName('Back Bay study', '2026-10-29T10:00:00Z')).toBe(
      'back-bay-study-2026-10-29.project.json',
    )
  })
})
