import { describe, expect, it } from 'vitest'
import { createInitialState } from '../domain/initialState.ts'
import { saveProject } from './persistence.ts'
import { buildFixture, FIXTURE_IDS } from './fixtures.ts'
import {
  CATALOG_KEY,
  readProjectCatalog,
  writeProjectCatalog,
  type CatalogEntry,
} from './projectCatalog.ts'

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
})
