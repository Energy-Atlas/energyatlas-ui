import { describe, expect, it } from 'vitest'
import { createInitialState } from '../domain/initialState.ts'
import { saveProject } from './persistence.ts'
import { buildFixture, FIXTURE_IDS } from './fixtures.ts'
import {
  CATALOG_KEY,
  INTERRUPTED,
  readProjectCatalog,
  restoreProject,
  writeProjectCatalog,
  type CatalogEntry,
} from './projectCatalog.ts'
import { retryBlocker } from '../domain/jobs/runGroups.ts'
import { finishJobNow, runStageNow } from '../domain/jobs/runNow.ts'
import { createWorkbench } from '../domain/workbench.ts'
import { STAGE_IDS } from '../domain/workflow.ts'

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
function entry(id: string): CatalogEntry {
  const state = createInitialState()
  state.project = { ...state.project, id, name: 'Same name' }
  return {
    id,
    name: state.project.name,
    state,
    savedAt: '2026-10-26T00:00:00.000Z',
    lastOpenedAt: null,
  }
}
describe('project catalog', () => {
  it.each(FIXTURE_IDS)(
    'accepts the complete domain shape of the %s fixture',
    (fixture) => {
      const storage = memoryStorage()
      const state = buildFixture(
        fixture,
        () => new Date('2026-10-26T00:00:00Z'),
      )
      const project = {
        ...entry('fixture'),
        name: state.project.name,
        state: { ...state, project: { ...state.project, id: 'fixture' } },
      }
      expect(writeProjectCatalog(storage, { projects: [project] }).ok).toBe(
        true,
      )
      expect(readProjectCatalog(storage).error).toBeNull()
    },
  )
  it.each([
    { workflow: { ...createInitialState().workflow, edges: [null] } },
    {
      workflow: {
        ...createInitialState().workflow,
        edges: [{ from: 'missing', to: 'also-missing' }],
      },
    },
    { assets: { broken: { id: 'broken', childIds: null } } },
  ])('rejects malformed nested graph and asset data (%j)', (invalid) => {
    const storage = memoryStorage()
    const saved = entry('one')
    storage.setItem(
      CATALOG_KEY,
      JSON.stringify({
        version: 1,
        projects: [{ ...saved, state: { ...saved.state, ...invalid } }],
      }),
    )
    expect(readProjectCatalog(storage).error).not.toBeNull()
  })
  it.each([{ tasks: { broken: null } }, { issues: undefined }])(
    'rejects incomplete saved-state collections (%j)',
    (invalid) => {
      const storage = memoryStorage()
      const saved = entry('one')
      storage.setItem(
        CATALOG_KEY,
        JSON.stringify({
          version: 1,
          projects: [{ ...saved, state: { ...saved.state, ...invalid } }],
        }),
      )
      expect(readProjectCatalog(storage).error).not.toBeNull()
    },
  )
  it('preserves the legacy saved project without changing its storage', () => {
    const storage = memoryStorage()
    saveProject(storage, createInitialState(), new Date('2026-10-25T00:00:00Z'))
    const original = storage.getItem('eaui.project.v2')
    const result = readProjectCatalog(storage)
    expect(result.error).toBeNull()
    expect(result.catalog.projects).toHaveLength(1)
    expect(result.catalog.projects[0]?.name).toBe('Synthetic district (demo)')
    expect(storage.getItem('eaui.project.v2')).toBe(original)
    expect(storage.getItem(CATALOG_KEY)).toBeNull()
  })
  it('round trips projects with equal names and distinct IDs', () => {
    const storage = memoryStorage()
    const catalog = { projects: [entry('one'), entry('two')] }
    expect(writeProjectCatalog(storage, catalog).ok).toBe(true)
    expect(readProjectCatalog(storage).catalog).toEqual(catalog)
  })
  it('reports malformed storage instead of replacing it', () => {
    const storage = memoryStorage()
    storage.setItem(CATALOG_KEY, '{broken')
    expect(readProjectCatalog(storage).error).toMatch(/could not be read/)
    expect(storage.getItem(CATALOG_KEY)).toBe('{broken')
  })
  it('reports unavailable and failed writes without changing saved data', () => {
    expect(writeProjectCatalog(null, { projects: [] }).ok).toBe(false)
    const storage = memoryStorage()
    writeProjectCatalog(storage, { projects: [entry('one')] })
    const original = storage.getItem(CATALOG_KEY)
    const blocked = {
      ...storage,
      setItem() {
        throw new Error('quota')
      },
    }
    expect(writeProjectCatalog(blocked, { projects: [entry('two')] }).ok).toBe(
      false,
    )
    expect(storage.getItem(CATALOG_KEY)).toBe(original)
  })

  it('migrates a save from before run groups and keeps its jobs as history', () => {
    const storage = memoryStorage()
    const state = buildFixture('partway', () => new Date())
    const legacy = JSON.parse(JSON.stringify(state)) as Record<string, unknown>
    delete legacy.runGroups
    delete legacy.runGroupIds
    for (const task of Object.values(
      legacy.tasks as Record<string, Record<string, unknown>>,
    )) {
      for (const key of [
        'groupId',
        'attempt',
        'parentTaskId',
        'requestId',
        'items',
      ])
        delete task[key]
    }
    storage.setItem(
      CATALOG_KEY,
      JSON.stringify({
        version: 1,
        projects: [
          {
            ...entry(state.project.id),
            name: state.project.name,
            state: legacy,
          },
        ],
      }),
    )
    const read = readProjectCatalog(storage)
    expect(read.error).toBeNull()
    const restored = read.catalog.projects[0]?.state
    expect(restored?.runGroups).toEqual({})
    const task = Object.values(restored?.tasks ?? {})[0]
    expect(task).toMatchObject({ groupId: null, attempt: 1, items: null })
    const opened = restoreProject(read.catalog.projects[0]!)
    expect(retryBlocker(opened, task?.id ?? '')).toMatch(/before retries/)
  })

  it('round-trips held results so a finished partial run stays retryable', () => {
    const storage = memoryStorage()
    const engine = createWorkbench({
      initialState: buildFixture('partway', () => new Date()),
    })
    // Rewind preprocessing into a partial failure.
    runStageNow(engine, STAGE_IDS.schema)
    engine.execute({
      type: 'workflow.runStage',
      input: { stageId: STAGE_IDS.preprocessing },
    })
    const failed = engine.getState().taskIds.at(-1) ?? ''
    finishJobNow(engine, failed, { failures: { B0002: 'Fault.' } })
    const state = engine.getState()
    const saved = {
      ...entry(state.project.id),
      name: state.project.name,
      state,
    }
    expect(writeProjectCatalog(storage, { projects: [saved] }).ok).toBe(true)
    const read = readProjectCatalog(storage)
    expect(read.error).toBeNull()
    const opened = restoreProject(read.catalog.projects[0]!)
    const group = opened.runGroups[opened.tasks[failed]?.groupId ?? '']
    expect(Object.keys(group?.held ?? {})).toHaveLength(463)
    expect(retryBlocker(opened, failed)).toBeNull()
  })

  it('interrupts previously active work on reopen and closes it to retries', () => {
    const engine = createWorkbench({
      initialState: buildFixture('partway', () => new Date()),
    })
    runStageNow(engine, STAGE_IDS.schema)
    engine.execute({
      type: 'workflow.runStage',
      input: { stageId: STAGE_IDS.preprocessing },
    })
    const active = engine.getState().taskIds.at(-1) ?? ''
    const state = engine.getState()
    const opened = restoreProject({
      ...entry(state.project.id),
      name: state.project.name,
      state,
    })
    expect(opened.tasks[active]).toMatchObject({
      status: 'cancelled',
      message: INTERRUPTED,
    })
    expect(opened.runGroups[opened.tasks[active]?.groupId ?? '']?.status).toBe(
      'cancelled',
    )
    expect(retryBlocker(opened, active)).toMatch(/fresh run/)
  })

  it('rejects a job that refers to a missing run group without changing storage', () => {
    const storage = memoryStorage()
    const state = buildFixture('partway', () => new Date())
    const broken = JSON.parse(JSON.stringify(state)) as typeof state
    const first = Object.values(broken.tasks)[0]
    if (first) first.groupId = 'group-missing'
    const raw = JSON.stringify({
      version: 1,
      projects: [
        { ...entry(state.project.id), name: state.project.name, state: broken },
      ],
    })
    storage.setItem(CATALOG_KEY, raw)
    expect(readProjectCatalog(storage).error).toBeTruthy()
    expect(storage.getItem(CATALOG_KEY)).toBe(raw)
  })
})
