import { TabNode } from 'flexlayout-react'
import { describe, expect, it } from 'vitest'
import { createWorkbench } from '../../domain/workbench.ts'
import { parseSavedView } from '../../server/projectCatalog.ts'
import { memoryStorage } from '../../testing/memoryStorage.ts'
import {
  describeAgentTools,
  executeToolCall,
  layoutsCall,
  requiresApproval,
} from '../agent/tools.ts'
import {
  createDefaultLayout,
  createLayoutController,
  MAIN_TABSET_ID,
  pageTabId,
  panelTabId,
  prepareArrangement,
} from '../layout/layoutController.ts'
import {
  createInitialViewState,
  describeViewOperations,
} from '../view/viewOperations.ts'
import { createViewStore } from '../view/viewStore.ts'
import { createInitialState } from '../../domain/initialState.ts'
import type { ProjectClient } from '../service/projectClient.ts'
import { createLayoutLibrary, type LayoutLibrary } from './layoutLibrary.ts'
import { PERSONAL_LAYOUTS_KEY } from './personalLayouts.ts'
import {
  applyViewSnapshot,
  captureViewSnapshot,
  parseLayoutList,
  uniqueLayoutName,
  type SavedLayout,
} from './savedLayout.ts'

function setup(storage: Storage | null = memoryStorage()) {
  const workbench = createWorkbench()
  const layout = createLayoutController(workbench, null)
  const view = createViewStore(workbench)
  const warnings: string[] = []
  const library = createLayoutLibrary({
    workbench,
    layout,
    view,
    storage,
    warn: (text) => warnings.push(text),
  })
  return { workbench, layout, view, library, warnings, storage }
}

function lastLog(workbench: ReturnType<typeof createWorkbench>) {
  return workbench.store.getState().log.at(-1)
}

function saved(library: LayoutLibrary, scope: 'project' | 'personal') {
  return library.store.getState()[scope].layouts
}

describe('saved layout shape', () => {
  it('captures view settings but not selections, drafts, or the chosen job', () => {
    const view = createInitialViewState()
    view.jobs.selectedTaskId = 'task-1'
    view.intake.datasetId = 'dataset-1'
    view.table.quickFilter = 'Back Bay'
    const snapshot = captureViewSnapshot(view)
    expect(snapshot.table.quickFilter).toBe('Back Bay')
    expect(snapshot).not.toHaveProperty('intake')
    expect(snapshot.jobs).toEqual({ filter: 'all' })
    expect(Object.keys(snapshot).sort()).toEqual([
      'dashboard',
      'jobs',
      'map',
      'results',
      'table',
      'tables',
    ])
  })

  it('keeps unreadable, foreign-scope, and repeated entries aside unchanged', () => {
    const { library } = setup()
    library.save({ name: 'A', scope: 'personal' })
    const good = saved(library, 'personal')[0] as SavedLayout
    const list = parseLayoutList(
      [good, { ...good }, { ...good, id: 'x', scope: 'project' }, 'junk'],
      'personal',
    )
    expect(list.layouts).toHaveLength(1)
    expect(list.unreadable).toHaveLength(3)
    expect(parseLayoutList(undefined, 'project')).toEqual({
      layouts: [],
      unreadable: [],
    })
    // A later format is not read by this version.
    expect(
      parseLayoutList([{ ...good, format: 2 }], 'personal').unreadable,
    ).toHaveLength(1)
  })

  it('numbers repeated names', () => {
    const layouts = [{ id: 'a', name: 'Review' }] as SavedLayout[]
    expect(uniqueLayoutName('Review', layouts)).toBe('Review (2)')
    expect(uniqueLayoutName('review', layouts, 'a')).toBe('review')
    expect(uniqueLayoutName('Other', layouts)).toBe('Other')
  })
})

/** Memory storage whose writes can be made to fail, as a full quota does. */
function failingStorage() {
  const storage = memoryStorage()
  const control = { fail: false }
  const setItem = storage.setItem.bind(storage)
  storage.setItem = (key, value) => {
    if (control.fail) throw new Error('Quota exceeded')
    setItem(key, value)
  }
  return { storage, control }
}

describe('preparing a saved arrangement', () => {
  it('keeps the selected tab selected after others are dropped, and names repeated tabs', () => {
    const tab = (component: string, name: string) => ({
      type: 'tab',
      component,
      name,
    })
    const prepared = prepareArrangement({
      layout: {
        type: 'row',
        children: [
          {
            type: 'tabset',
            id: MAIN_TABSET_ID,
            selected: 3,
            children: [
              tab('page.gone', 'Gone'),
              tab('page.map', 'Map'),
              tab('page.map', 'Map'),
              tab('page.table', 'Table'),
            ],
          },
          {
            type: 'tabset',
            id: 'second',
            selected: 0,
            children: [
              tab('page.gone', 'Gone'),
              tab('page.roadmap', 'Roadmap'),
              tab('page.results', 'Results'),
            ],
          },
        ],
      },
    })
    if (!prepared.ok) throw new Error(prepared.message)
    const [main, second] = (prepared.json.layout.children ?? []) as {
      selected: number
      children: { id: string }[]
    }[]
    // Table stays selected; the dropped selected tab falls back to the first.
    expect(main?.children[main.selected]?.id).toBe(pageTabId('table'))
    expect(second?.selected).toBe(0)
    expect(prepared.dropped).toEqual([
      '"Gone"',
      'a repeated "Map" tab',
      '"Gone"',
    ])
  })

  it('drops tabs this version does not have and names them', () => {
    const json = structuredClone(createDefaultLayout()) as unknown as {
      layout: { children: { children: unknown[] }[] }
    }
    json.layout.children[0]?.children.push({
      type: 'tab',
      id: 'page:gone',
      name: 'Gone page',
      component: 'page.gone',
    })
    const prepared = prepareArrangement(json)
    expect(prepared).toMatchObject({ ok: true, dropped: ['"Gone page"'] })
  })

  it('refuses an arrangement without a tab group instead of showing nothing', () => {
    expect(
      prepareArrangement({ layout: { type: 'row', children: [] } }),
    ).toEqual({
      ok: false,
      message:
        'The layout has no tab group for pages that this version can show.',
    })
    expect(prepareArrangement('nope')).toMatchObject({ ok: false })
  })

  it('adds missing side containers, keeps the app settings, and follows the docking mode', () => {
    const prepared = prepareArrangement(
      {
        global: { tabEnableRenderOnDemand: true },
        layout: {
          type: 'row',
          children: [
            {
              type: 'tabset',
              id: MAIN_TABSET_ID,
              selected: 7,
              children: [{ type: 'tab', component: 'page.map', name: 'Map' }],
            },
          ],
        },
      },
      true,
    )
    if (!prepared.ok) throw new Error(prepared.message)
    expect(prepared.json.global?.tabEnableRenderOnDemand).toBe(false)
    expect(prepared.json.borders?.map((border) => border.location)).toEqual([
      'left',
      'right',
    ])
    expect(prepared.json.borders?.[0]?.borderType).toBe('overlay')
    const tabset = prepared.json.layout.children?.[0] as {
      selected: number
      children: { id: string }[]
    }
    expect(tabset.selected).toBe(0)
    expect(tabset.children[0]?.id).toBe(pageTabId('map'))
  })
})

describe('applying view settings', () => {
  it('skips a broken section with a note and keeps the rest', () => {
    const view = createInitialViewState()
    const notes = applyViewSnapshot(
      view,
      {
        table: { view: 'grid', quickFilter: 'abc' },
        map: { layers: 'broken' },
        jobs: { filter: 'finished' },
      },
      createInitialState(),
    )
    expect(view.table).toEqual({ view: 'grid', quickFilter: 'abc' })
    expect(view.jobs.filter).toBe('finished')
    expect(notes).toEqual([
      'The map settings in this layout could not be read and were left as they are.',
    ])
  })

  it('leaves out results and charts the project has not published', () => {
    const view = createInitialViewState()
    const notes = applyViewSnapshot(
      view,
      {
        results: {
          resultId: 'scenario-9',
          buildingId: 'B1',
          resolution: 'hourly',
        },
        dashboard: {
          hiddenScenarioIds: ['scenario-9'],
          charts: [
            {
              id: 'chart-4',
              title: 'Demand',
              kind: 'bar',
              measure: 'annual',
              series: ['baseline'],
            },
          ],
        },
        map: {
          layers: [],
          view3d: false,
          terrain: true,
          terrainExaggeration: 1,
          lighting: createInitialViewState().map.lighting,
        },
      },
      createInitialState(),
    )
    expect(view.results).toEqual({
      resultId: 'baseline',
      buildingId: null,
      resolution: 'monthly',
    })
    expect(view.dashboard).toEqual({ hiddenScenarioIds: [], charts: [] })
    // Terrain belongs to the 3D view.
    expect(view.map.terrain).toBe(false)
    expect(notes).toHaveLength(2)
    expect(notes[0]).toContain('Dashboard chart')
    expect(notes[1]).toContain('scenario-9')
  })

  it('is internal to saved layouts, not an agent view tool', () => {
    expect(
      describeViewOperations().map((operation) => operation.type),
    ).not.toContain('view.applyLayout')
  })
})

describe('layout library', () => {
  it('saves a personal layout in the browser and a project layout in memory', () => {
    const { library, storage, workbench } = setup()
    expect(library.save({ name: 'Mine', scope: 'personal' }).status).toBe(
      'applied',
    )
    expect(storage?.getItem(PERSONAL_LAYOUTS_KEY)).toContain('"Mine"')
    expect(library.save({ name: 'Team', scope: 'project' })).toMatchObject({
      status: 'applied',
      summary: 'Saved the project layout "Team". Save the project to keep it.',
    })
    expect(lastLog(workbench)).toMatchObject({
      type: 'layouts.save',
      source: 'manual',
    })
    expect(library.forSave().layouts).toHaveLength(1)
    expect(library.projectDiffers(null)).toBe(true)
    expect(library.projectDiffers({ tables: {}, ...library.forSave() })).toBe(
      false,
    )
  })

  it('refuses an empty or repeated name on its field', () => {
    const { library } = setup()
    expect(library.save({ name: '  ', scope: 'personal' })).toMatchObject({
      status: 'rejected',
      issues: [{ path: 'name', message: 'Enter a layout name.' }],
    })
    library.save({ name: 'Review', scope: 'personal' })
    expect(library.save({ name: 'review', scope: 'personal' })).toMatchObject({
      status: 'rejected',
      issues: [{ path: 'name' }],
    })
    // The same name is fine in the other scope.
    expect(library.save({ name: 'Review', scope: 'project' }).status).toBe(
      'applied',
    )
  })

  it('applies the arrangement and view settings as one logged operation, and resets to it', () => {
    const { library, layout, view, workbench } = setup()
    view.execute({ type: 'table.setQuickFilter', input: { text: 'office' } })
    layout.placePage('table', 'map', 'right')
    const save = library.save({ name: 'Side by side', scope: 'personal' })
    if (save.status !== 'applied' || !save.ref) throw new Error('not saved')
    expect(library.changedSinceApplied()).toBe(false)

    layout.reset()
    view.execute({ type: 'table.setQuickFilter', input: { text: '' } })
    expect(library.changedSinceApplied()).toBe(true)

    const before = workbench.store.getState().log.length
    const applied = library.apply(save.ref, 'agent')
    expect(applied.status).toBe('applied')
    expect(workbench.store.getState().log.length).toBe(before + 1)
    expect(lastLog(workbench)).toMatchObject({
      type: 'layouts.apply',
      source: 'agent',
      summary: 'Applied the personal layout "Side by side".',
    })
    expect(view.getState().table.quickFilter).toBe('office')
    const map = layout.getModel().getNodeById(pageTabId('map'))
    const table = layout.getModel().getNodeById(pageTabId('table'))
    expect(map instanceof TabNode && table instanceof TabNode).toBe(true)
    expect((map as TabNode).getParent()?.getId()).not.toBe(
      (table as TabNode).getParent()?.getId(),
    )
    expect(library.changedSinceApplied()).toBe(false)

    view.execute({ type: 'jobs.setFilter', input: { filter: 'finished' } })
    expect(library.changedSinceApplied()).toBe(true)
    expect(library.resetToApplied().status).toBe('applied')
    expect(view.getState().jobs.filter).toBe('all')
    expect(lastLog(workbench)?.type).toBe('layouts.reset')
  })

  it('reports tabs it left out as a warning and keeps the current layout on a broken arrangement', () => {
    const { library, layout, warnings, workbench } = setup()
    const save = library.save({ name: 'Old', scope: 'project' })
    if (save.status !== 'applied' || !save.ref) throw new Error('not saved')
    const stored = library.forSave().layouts[0] as SavedLayout
    const arrangement = structuredClone(stored.arrangement) as {
      layout: { children: { children: unknown[] }[] }
    }
    arrangement.layout.children[0]?.children.push({
      type: 'tab',
      component: 'page.removed',
      name: 'Removed page',
    })
    library.resetForProject(
      {
        tables: {},
        layouts: [
          { ...stored, arrangement },
          {
            ...stored,
            id: 'broken',
            name: 'Broken',
            arrangement: { layout: { type: 'row' } },
          },
        ],
      },
      'key',
    )
    expect(library.apply({ scope: 'project', id: stored.id }).status).toBe(
      'applied',
    )
    expect(warnings[0]).toContain('"Removed page"')

    const model = layout.getModel()
    const outcome = library.apply({ scope: 'project', id: 'broken' })
    expect(outcome.status).toBe('rejected')
    expect(layout.getModel()).toBe(model)
    expect(lastLog(workbench)?.issues[0]?.message).toContain(
      'The current layout is unchanged.',
    )
  })

  it('renames, duplicates, copies across scopes, and deletes', () => {
    const { library } = setup()
    const save = library.save({ name: 'A', scope: 'project' })
    if (save.status !== 'applied' || !save.ref) throw new Error('not saved')
    expect(library.rename(save.ref, 'B').status).toBe('applied')
    expect(library.store.getState().applied?.name).toBe('B')
    expect(library.duplicate(save.ref)).toMatchObject({
      status: 'applied',
      summary: 'Duplicated the layout "B" as "B copy".',
    })
    expect(library.duplicate(save.ref, 'manual', 'personal')).toMatchObject({
      status: 'applied',
      summary: 'Copied the project layout "B" to the personal layouts as "B".',
    })
    expect(library.setDefault(save.ref.id).status).toBe('applied')
    expect(library.remove(save.ref)).toMatchObject({
      status: 'applied',
      summary:
        'Deleted the project layout "B". The project no longer opens with a default layout.',
    })
    expect(library.store.getState().defaultId).toBeNull()
    expect(library.store.getState().applied).toBeNull()
    expect(library.resetBlocker()).toContain('No saved layout has been applied')
    expect(saved(library, 'project').map((each) => each.name)).toEqual([
      'B copy',
    ])
  })

  it('opens a project with its default layout and treats those views as saved', () => {
    const { library, view } = setup()
    view.execute({ type: 'table.setQuickFilter', input: { text: 'school' } })
    const save = library.save({ name: 'Default', scope: 'project' })
    if (save.status !== 'applied' || !save.ref) throw new Error('not saved')
    library.setDefault(save.ref.id)
    const stored = { tables: {}, ...library.forSave() }
    view.execute({ type: 'table.setQuickFilter', input: { text: '' } })

    library.resetForProject(stored, 'session-1')
    expect(view.getState().table.quickFilter).toBe('school')
    expect(library.store.getState().applied?.name).toBe('Default')
    expect(library.store.getState().openedView?.key).toBe('session-1')
    expect(library.projectDiffers(stored)).toBe(false)

    // A default that no longer exists is ignored.
    library.resetForProject({ ...stored, defaultLayoutId: 'missing' }, 'k')
    expect(library.store.getState().defaultId).toBeNull()
    expect(library.store.getState().applied).toBeNull()
  })

  it('explains blocked and unreadable browser storage, and recovers only when asked', () => {
    const blocked = setup(null)
    expect(
      blocked.library.save({ name: 'X', scope: 'personal' }),
    ).toMatchObject({ status: 'rejected' })
    expect(blocked.library.saveBlocker('personal')).toContain(
      'Browser storage is unavailable',
    )
    expect(blocked.library.save({ name: 'X', scope: 'project' }).status).toBe(
      'applied',
    )

    const storage = memoryStorage()
    storage.setItem(PERSONAL_LAYOUTS_KEY, '{not json')
    const broken = setup(storage)
    expect(broken.library.store.getState().personalStatus.kind).toBe(
      'unreadable',
    )
    expect(broken.library.save({ name: 'X', scope: 'personal' }).status).toBe(
      'rejected',
    )
    expect(storage.getItem(PERSONAL_LAYOUTS_KEY)).toBe('{not json')
    expect(broken.library.removeUnreadablePersonal().status).toBe('applied')
    expect(storage.getItem(PERSONAL_LAYOUTS_KEY)).toBeNull()
    expect(broken.library.save({ name: 'X', scope: 'personal' }).status).toBe(
      'applied',
    )
  })

  it('keeps project layouts read-only where they are not writable', () => {
    const workbench = createWorkbench()
    const layout = createLayoutController(workbench, null)
    const view = createViewStore(workbench)
    const writable = createLayoutLibrary({
      workbench,
      layout,
      view,
      storage: memoryStorage(),
    })
    writable.save({ name: 'Handed over', scope: 'project' })
    const viewer = createLayoutLibrary({
      workbench,
      layout,
      view,
      storage: memoryStorage(),
      projectWritable: false,
    })
    viewer.resetForProject({ tables: {}, ...writable.forSave() }, 'k')
    const ref = {
      scope: 'project' as const,
      id: saved(viewer, 'project')[0]?.id ?? '',
    }
    expect(viewer.apply(ref).status).toBe('applied')
    expect(viewer.remove(ref).status).toBe('rejected')
    expect(viewer.save({ name: 'Y', scope: 'project' }).status).toBe('rejected')
    expect(viewer.duplicate(ref, 'manual', 'personal').status).toBe('applied')
  })
})

describe('keeping what others wrote', () => {
  it('keeps fields a later version added, and a default naming an unreadable layout', () => {
    const { library } = setup()
    library.save({ name: 'A', scope: 'project' })
    const stored = library.forSave().layouts[0] as SavedLayout
    const future = { ...stored, futureField: { kept: true } }
    const unreadable = { ...stored, id: 'from-later', format: 2 }
    const saved = {
      tables: {},
      layouts: [future, unreadable],
      defaultLayoutId: 'from-later',
    }
    library.resetForProject(saved, 'k')
    // Not applied here, but kept and saved back unchanged.
    expect(library.store.getState().applied).toBeNull()
    expect(library.forSave()).toEqual({
      layouts: [future, unreadable],
      defaultLayoutId: 'from-later',
    })
    expect(library.projectDiffers(saved)).toBe(false)
    // Choosing a default replaces the kept one.
    library.setDefault(stored.id)
    expect(library.forSave().defaultLayoutId).toBe(stored.id)
  })

  it('keeps a personal layout another tab saved meanwhile', () => {
    const storage = memoryStorage()
    const first = setup(storage)
    const second = setup(storage)
    first.library.save({ name: 'From the first tab', scope: 'personal' })
    // The second tab has not seen it yet, and saves its own.
    expect(saved(second.library, 'personal')).toHaveLength(0)
    second.library.save({ name: 'From the second tab', scope: 'personal' })
    expect(
      saved(second.library, 'personal').map((layout) => layout.name),
    ).toEqual(['From the first tab', 'From the second tab'])
    expect(storage.getItem(PERSONAL_LAYOUTS_KEY)).toContain(
      'From the first tab',
    )
  })

  it('leaves personal layouts as they were when storing fails', () => {
    const { storage, control } = failingStorage()
    const { library, workbench } = setup(storage)
    const save = library.save({ name: 'Kept', scope: 'personal' })
    if (save.status !== 'applied' || !save.ref) throw new Error('not saved')
    const before = storage.getItem(PERSONAL_LAYOUTS_KEY)
    control.fail = true
    for (const outcome of [
      library.rename(save.ref, 'Other'),
      library.update(save.ref),
      library.remove(save.ref),
    ]) {
      expect(outcome).toMatchObject({
        status: 'rejected',
        issues: [
          {
            message: 'Personal layouts could not be stored: Quota exceeded',
          },
        ],
      })
    }
    expect(lastLog(workbench)?.status).toBe('rejected')
    expect(storage.getItem(PERSONAL_LAYOUTS_KEY)).toBe(before)
    expect(saved(library, 'personal').map((layout) => layout.name)).toEqual([
      'Kept',
    ])
  })
})

describe('saved layouts with the project and for the agent', () => {
  it('keeps layouts and the default with the saved view, dropping only an unreadable optional field', () => {
    expect(
      parseSavedView({ tables: {}, layouts: [1], defaultLayoutId: 'a' }),
    ).toEqual({ tables: {}, layouts: [1], defaultLayoutId: 'a' })
    expect(parseSavedView({ tables: {}, layouts: 'bad' })).toEqual({
      tables: {},
    })
    expect(parseSavedView({ tables: [] })).toBeNull()
  })

  it('offers every layout operation as an agent tool, asking approval only to overwrite or delete', async () => {
    const tools = describeAgentTools().filter((tool) => tool.kind === 'layouts')
    expect(tools.map((tool) => tool.name)).toEqual([
      'layouts.list',
      'layouts.save',
      'layouts.apply',
      'layouts.update',
      'layouts.rename',
      'layouts.duplicate',
      'layouts.delete',
      'layouts.setDefault',
      'layouts.reset',
    ])
    expect(
      tools.filter((tool) => tool.requiresApproval).map((tool) => tool.name),
    ).toEqual(['layouts.update', 'layouts.delete'])
    expect(
      requiresApproval(
        layoutsCall({
          type: 'layouts.delete',
          input: { scope: 'personal', layoutId: 'x' },
        }),
      ),
    ).toBe(true)

    const { workbench, layout, view, library } = setup()
    const deps = {
      workbench,
      layout,
      view,
      layouts: library,
      // Layout tools never reach the server.
      client: {} as ProjectClient,
    }
    const result = await executeToolCall(
      deps,
      layoutsCall({
        type: 'layouts.save',
        input: { name: 'Agent view', scope: 'personal' },
      }),
    )
    expect(result).toMatchObject({ status: 'applied' })
    expect(lastLog(workbench)?.source).toBe('agent')
    const listed = await executeToolCall(
      deps,
      layoutsCall({ type: 'layouts.list', input: {} }),
    )
    expect(listed.data).toMatchObject({
      layouts: [{ name: 'Agent view', scope: 'personal', isApplied: true }],
    })
    expect(layout.getModel().getNodeById(panelTabId('assets'))).toBeDefined()
  })
})
