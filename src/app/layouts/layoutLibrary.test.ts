import { TabNode } from 'flexlayout-react'
import { describe, expect, it } from 'vitest'
import { createWorkbench } from '../../domain/workbench.ts'
import { parseSavedView } from '../../server/projectCatalog.ts'
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
import { focusLayout, layoutsPanelStore } from './layoutsPanelStore.ts'
import {
  applyViewSnapshot,
  captureViewSnapshot,
  MAX_LAYOUTS,
  parseLayoutList,
  uniqueLayoutName,
  type SavedLayout,
} from './savedLayout.ts'

function setup() {
  const workbench = createWorkbench()
  const layout = createLayoutController(workbench, null)
  const view = createViewStore(workbench)
  const warnings: string[] = []
  const library = createLayoutLibrary({
    workbench,
    layout,
    view,
    warn: (text) => warnings.push(text),
  })
  return { workbench, layout, view, library, warnings }
}

function lastLog(workbench: ReturnType<typeof createWorkbench>) {
  return workbench.store.getState().log.at(-1)
}

function saved(library: LayoutLibrary) {
  return library.store.getState().project.layouts
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

  it('keeps unreadable, personal, and repeated entries aside unchanged', () => {
    const { library } = setup()
    library.save({ name: 'A' })
    const good = saved(library)[0] as SavedLayout
    expect(good.scope).toBe('project')
    // Personal layouts are gone (decision 0033): one stored so is unreadable.
    const list = parseLayoutList([
      good,
      { ...good },
      { ...good, id: 'x', scope: 'personal' },
      'junk',
    ])
    expect(list.layouts).toHaveLength(1)
    expect(list.unreadable).toHaveLength(3)
    expect(parseLayoutList(undefined)).toEqual({
      layouts: [],
      unreadable: [],
    })
    // A later format is not read by this version.
    expect(parseLayoutList([{ ...good, format: 2 }]).unreadable).toHaveLength(1)
  })

  it('numbers repeated names', () => {
    const layouts = [{ id: 'a', name: 'Review' }] as SavedLayout[]
    expect(uniqueLayoutName('Review', layouts)).toBe('Review (2)')
    expect(uniqueLayoutName('review', layouts, 'a')).toBe('review')
    expect(uniqueLayoutName('Other', layouts)).toBe('Other')
  })
})

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
  it('saves a layout with the project, in memory until the project is saved', () => {
    const { library, workbench } = setup()
    expect(library.save({ name: 'Team' })).toMatchObject({
      status: 'applied',
      summary: 'Saved the layout "Team". Save the project to keep it.',
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
    expect(library.save({ name: '  ' })).toMatchObject({
      status: 'rejected',
      issues: [{ path: 'name', message: 'Enter a layout name.' }],
    })
    library.save({ name: 'Review' })
    expect(library.save({ name: 'review' })).toMatchObject({
      status: 'rejected',
      issues: [{ path: 'name' }],
    })
    const other = library.save({ name: 'Other' })
    if (other.status !== 'applied' || !other.id) throw new Error('not saved')
    expect(library.rename(other.id, 'REVIEW')).toMatchObject({
      status: 'rejected',
      issues: [{ path: 'name' }],
    })
    expect(library.rename(other.id, 'Other')).toMatchObject({
      status: 'rejected',
      issues: [
        { path: 'name', message: 'The layout is already named "Other".' },
      ],
    })
  })

  it(`keeps at most ${MAX_LAYOUTS} layouts in a project`, () => {
    const { library } = setup()
    for (let index = 0; index < MAX_LAYOUTS; index += 1) {
      library.save({ name: `Layout ${index}` })
    }
    const full = `This project already has ${MAX_LAYOUTS} layouts. Delete one first.`
    expect(library.saveBlocker()).toBe(full)
    expect(library.save({ name: 'One more' })).toMatchObject({
      status: 'rejected',
      issues: [{ message: full }],
    })
    const first = saved(library)[0] as SavedLayout
    expect(library.duplicate(first.id)).toMatchObject({
      status: 'rejected',
      issues: [{ message: full }],
    })
    expect(library.remove(first.id).status).toBe('applied')
    expect(library.saveBlocker()).toBeNull()
  })

  it('applies the arrangement and view settings as one logged operation, and resets to it', () => {
    const { library, layout, view, workbench } = setup()
    view.execute({ type: 'table.setQuickFilter', input: { text: 'office' } })
    layout.placePage('table', 'map', 'right')
    const save = library.save({ name: 'Side by side' })
    if (save.status !== 'applied' || !save.id) throw new Error('not saved')
    expect(library.changedSinceApplied()).toBe(false)

    layout.reset()
    view.execute({ type: 'table.setQuickFilter', input: { text: '' } })
    expect(library.changedSinceApplied()).toBe(true)

    const before = workbench.store.getState().log.length
    const applied = library.apply(save.id, 'agent')
    expect(applied).toMatchObject({ status: 'applied', id: save.id })
    expect(workbench.store.getState().log.length).toBe(before + 1)
    expect(lastLog(workbench)).toMatchObject({
      type: 'layouts.apply',
      source: 'agent',
      summary: 'Applied the layout "Side by side".',
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
    expect(library.resetToApplied()).toMatchObject({
      status: 'applied',
      summary: 'Reset the panels and views to the layout "Side by side".',
    })
    expect(view.getState().jobs.filter).toBe('all')
    expect(lastLog(workbench)?.type).toBe('layouts.reset')
  })

  it('updates a layout with the current panels and views', () => {
    const { library, view } = setup()
    const save = library.save({ name: 'Working' })
    if (save.status !== 'applied' || !save.id) throw new Error('not saved')
    view.execute({ type: 'table.setQuickFilter', input: { text: 'library' } })
    expect(library.changedSinceApplied()).toBe(true)
    expect(library.update(save.id)).toMatchObject({
      status: 'applied',
      summary:
        'Updated the layout "Working" with the current panels and views.',
    })
    expect(library.changedSinceApplied()).toBe(false)
    view.execute({ type: 'table.setQuickFilter', input: { text: '' } })
    library.apply(save.id)
    expect(view.getState().table.quickFilter).toBe('library')
  })

  it('reports tabs it left out as a warning and keeps the current layout on a broken arrangement', () => {
    const { library, layout, warnings, workbench } = setup()
    const save = library.save({ name: 'Old' })
    if (save.status !== 'applied' || !save.id) throw new Error('not saved')
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
    expect(library.apply(stored.id).status).toBe('applied')
    expect(warnings[0]).toContain('"Removed page"')
    expect(lastLog(workbench)?.summary).toBe(
      'Applied the layout "Old". Some parts were left out.',
    )

    const model = layout.getModel()
    const outcome = library.apply('broken')
    expect(outcome.status).toBe('rejected')
    expect(layout.getModel()).toBe(model)
    expect(lastLog(workbench)?.issues[0]?.message).toContain(
      'The current layout is unchanged.',
    )
    expect(library.apply('missing')).toMatchObject({
      status: 'rejected',
      issues: [{ path: 'layoutId', message: 'There is no layout "missing".' }],
    })
  })

  it('renames, duplicates, and deletes', () => {
    const { library } = setup()
    const save = library.save({ name: 'A' })
    if (save.status !== 'applied' || !save.id) throw new Error('not saved')
    expect(library.rename(save.id, 'B')).toMatchObject({
      status: 'applied',
      summary: 'Renamed the layout "A" to "B".',
    })
    expect(library.store.getState().applied?.name).toBe('B')
    expect(library.duplicate(save.id)).toMatchObject({
      status: 'applied',
      summary: 'Duplicated the layout "B" as "B copy".',
    })
    // A second copy gets a numbered name.
    expect(library.duplicate(save.id)).toMatchObject({
      status: 'applied',
      summary: 'Duplicated the layout "B" as "B copy (2)".',
    })
    expect(library.setDefault(save.id).status).toBe('applied')
    expect(library.remove(save.id)).toMatchObject({
      status: 'applied',
      summary:
        'Deleted the layout "B". The project no longer opens with a default layout.',
    })
    expect(library.store.getState().defaultId).toBeNull()
    expect(library.store.getState().applied).toBeNull()
    expect(library.resetBlocker()).toContain('No saved layout has been applied')
    expect(saved(library).map((each) => each.name)).toEqual([
      'B copy',
      'B copy (2)',
    ])
  })

  it('opens a project with its default layout and treats those views as saved', () => {
    const { library, view } = setup()
    view.execute({ type: 'table.setQuickFilter', input: { text: 'school' } })
    const save = library.save({ name: 'Default' })
    if (save.status !== 'applied' || !save.id) throw new Error('not saved')
    library.setDefault(save.id)
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

  it('keeps project layouts read-only where they are not writable', () => {
    const workbench = createWorkbench()
    const layout = createLayoutController(workbench, null)
    const view = createViewStore(workbench)
    const writable = createLayoutLibrary({ workbench, layout, view })
    writable.save({ name: 'Handed over' })
    const viewer = createLayoutLibrary({
      workbench,
      layout,
      view,
      writable: false,
    })
    expect(viewer.writable).toBe(false)
    viewer.resetForProject({ tables: {}, ...writable.forSave() }, 'k')
    const id = saved(viewer)[0]?.id ?? ''
    expect(viewer.apply(id).status).toBe('applied')
    const readOnly = {
      status: 'rejected',
      issues: [
        {
          message:
            'Handed-over layouts are read-only here; apply one to use it.',
        },
      ],
    }
    expect(viewer.saveBlocker()).toBe(readOnly.issues[0]?.message)
    expect(viewer.changeBlocker(id)).toBe(readOnly.issues[0]?.message)
    expect(viewer.save({ name: 'Y' })).toMatchObject(readOnly)
    expect(viewer.update(id)).toMatchObject(readOnly)
    expect(viewer.rename(id, 'Z')).toMatchObject(readOnly)
    expect(viewer.duplicate(id)).toMatchObject(readOnly)
    expect(viewer.remove(id)).toMatchObject(readOnly)
    expect(viewer.setDefault(id)).toMatchObject(readOnly)
    expect(saved(viewer).map((each) => each.name)).toEqual(['Handed over'])
  })
})

describe('the layout chosen in the asset tree', () => {
  const focused = () => layoutsPanelStore.getState().focusId

  it('stays marked only until a layout is applied, it is deleted, or another project opens', () => {
    const { library } = setup()
    library.save({ name: 'Alpha' })
    library.save({ name: 'Beta' })
    const alpha = saved(library)[0]!.id
    const beta = saved(library)[1]!.id

    focusLayout(alpha)
    library.apply(beta)
    expect(focused()).toBeNull()

    focusLayout(alpha)
    library.apply(alpha)
    expect(focused()).toBeNull()

    // Deleting another layout keeps the mark; deleting the chosen one clears it.
    focusLayout(alpha)
    library.duplicate(beta)
    const copy = saved(library)[2]!.id
    library.remove(copy)
    expect(focused()).toBe(alpha)
    library.remove(alpha)
    expect(focused()).toBeNull()

    focusLayout(beta)
    library.resetForProject(null, 'another')
    expect(focused()).toBeNull()
  })
})

describe('keeping what others wrote', () => {
  it('keeps fields a later version added, and a default naming an unreadable layout', () => {
    const { library } = setup()
    library.save({ name: 'A' })
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
})

describe('saved layouts with the project and for the agent', () => {
  it('keeps layouts and the default with the saved view, dropping only an unreadable default', () => {
    expect(
      parseSavedView({ tables: {}, layouts: [1], defaultLayoutId: 'a' }),
    ).toEqual({ tables: {}, layouts: [1], defaultLayoutId: 'a' })
    expect(parseSavedView({ tables: {}, defaultLayoutId: 3 })).toEqual({
      tables: {},
    })
    expect(parseSavedView({ tables: [] })).toBeNull()
  })

  it('keeps a layouts value that is not a list aside, so saving does not erase it', () => {
    const odd = { version: 9, items: ['from a later version'] }
    const view = parseSavedView({ tables: {}, layouts: odd })
    expect(view).toEqual({ tables: {}, layouts: [odd] })
    const { library } = setup()
    library.resetForProject(view, 'k')
    expect(library.store.getState().project).toEqual({
      layouts: [],
      unreadable: [odd],
    })
    // Kept through a save alongside a new layout, and reported as unreadable.
    library.save({ name: 'New' })
    const stored = library.forSave().layouts
    expect(stored).toHaveLength(2)
    expect(stored[1]).toEqual(odd)
    expect(library.projectDiffers(view)).toBe(true)
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
    // No layout tool takes a scope any more (decision 0033).
    expect(JSON.stringify(tools.map((tool) => tool.inputSchema))).not.toContain(
      'scope',
    )
    expect(
      requiresApproval(
        layoutsCall({ type: 'layouts.delete', input: { layoutId: 'x' } }),
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
      layoutsCall({ type: 'layouts.save', input: { name: 'Agent view' } }),
    )
    expect(result).toMatchObject({ status: 'applied' })
    expect(lastLog(workbench)?.source).toBe('agent')
    const listed = await executeToolCall(
      deps,
      layoutsCall({ type: 'layouts.list', input: {} }),
    )
    expect(listed.data).toMatchObject({
      layouts: [{ name: 'Agent view', isApplied: true, isDefault: false }],
    })
    const [item] = (listed.data as { layouts: Record<string, unknown>[] })
      .layouts
    expect(item).not.toHaveProperty('scope')
    const duplicated = await executeToolCall(
      deps,
      layoutsCall({
        type: 'layouts.duplicate',
        input: { layoutId: String(item?.layoutId) },
      }),
    )
    expect(duplicated).toMatchObject({
      status: 'applied',
      summary: 'Duplicated the layout "Agent view" as "Agent view copy".',
    })
    expect(layout.getModel().getNodeById(panelTabId('assets'))).toBeDefined()
  })
})
