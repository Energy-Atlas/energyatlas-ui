import { Actions, DockLocation, TabNode } from 'flexlayout-react'
import { describe, expect, it } from 'vitest'
import { createWorkbench } from '../../domain/workbench.ts'
import {
  createLayoutController,
  MAIN_TABSET_ID,
  pageTabId,
  panelTabId,
  type LayoutController,
  type PageId,
} from './layoutController.ts'

function tab(layout: LayoutController, page: PageId): TabNode {
  const node = layout.getModel().getNodeById(pageTabId(page))
  if (!(node instanceof TabNode)) throw new Error(`No tab for ${page}.`)
  return node
}

function setup() {
  const workbench = createWorkbench()
  return { workbench, layout: createLayoutController(workbench, null) }
}

describe('layout controller operations', () => {
  it('places a page beside another and keeps both visible', () => {
    const { workbench, layout } = setup()
    layout.placePage('map', 'table', 'right', 'agent')

    expect(tab(layout, 'map').getParent()?.getId()).not.toBe(
      tab(layout, 'table').getParent()?.getId(),
    )
    expect(tab(layout, 'map').isSelected()).toBe(true)
    expect(tab(layout, 'table').isSelected()).toBe(true)
    expect(workbench.store.getState().log.at(-1)).toMatchObject({
      type: 'layout.placePage',
      source: 'agent',
      status: 'applied',
      summary: 'Placed the Map page to the right of the Table page.',
    })
  })

  it('rejects placing a page beside itself', () => {
    const { workbench, layout } = setup()
    layout.placePage('map', 'map')
    expect(workbench.store.getState().log.at(-1)).toMatchObject({
      type: 'layout.placePage',
      status: 'rejected',
      issues: [{ path: '', message: 'Choose two different pages.' }],
    })
  })

  it('counts a page or panel as open only while it is on screen', () => {
    const { layout } = setup()
    expect(layout.isPageOpen('map')).toBe(true)
    expect(layout.isPageOpen('table')).toBe(false)
    expect(layout.isPanelOpen('assets')).toBe(true)
    expect(layout.isPanelOpen('workflow')).toBe(false)

    // Collapsing a side container hides its panels.
    layout.toggleSide('left')
    expect(layout.isPanelOpen('assets')).toBe(false)

    // A panel docked among the pages is open while it is the selected tab.
    const model = layout.getModel()
    model.doAction(
      Actions.moveNode(
        panelTabId('reasoning'),
        MAIN_TABSET_ID,
        DockLocation.CENTER,
        -1,
        true,
      ),
    )
    expect(layout.isPanelOpen('reasoning')).toBe(true)
    expect(layout.isPageOpen('map')).toBe(false)
    layout.openPage('map')
    expect(layout.isPanelOpen('reasoning')).toBe(false)
    expect(layout.isPageOpen('map')).toBe(true)

    // A maximized tab set hides the pages in every other tab set.
    layout.placePage('table', 'map', 'right')
    expect(layout.isPageOpen('map')).toBe(true)
    layout.toggleMaximize()
    expect(layout.isPageOpen('table')).toBe(true)
    expect(layout.isPageOpen('map')).toBe(false)
    layout.openPage('map')
    expect(model.getMaximizedTabset()).toBeUndefined()
    expect(layout.isPageOpen('map')).toBe(true)
  })

  it('hides a panel docked among the pages by closing it, and docks it home again', () => {
    const { workbench, layout } = setup()
    layout
      .getModel()
      .doAction(
        Actions.moveNode(
          panelTabId('inspection'),
          MAIN_TABSET_ID,
          DockLocation.CENTER,
          -1,
          true,
        ),
      )
    layout.togglePanel('inspection')
    expect(layout.getModel().getNodeById(panelTabId('inspection'))).toBe(
      undefined,
    )
    expect(workbench.store.getState().log.at(-1)?.summary).toBe(
      'Closed the Properties panel. Showing it again docks it on the right side.',
    )

    layout.togglePanel('inspection')
    expect(layout.isPanelOpen('inspection')).toBe(true)
  })

  it('splits and moves the active tab from the keyboard, explaining blockers', () => {
    const { workbench, layout } = setup()
    expect(layout.moveActiveTabBlocker()).toBe(
      'There is only one tab group. Split a tab into a new group first.',
    )
    layout.moveActiveTabToNextGroup()
    expect(workbench.store.getState().log.at(-1)?.status).toBe('rejected')

    expect(layout.splitActiveTabBlocker()).toBeNull()
    layout.splitActiveTab('right')
    expect(workbench.store.getState().log.at(-1)).toMatchObject({
      type: 'layout.splitTab',
      status: 'applied',
    })

    expect(layout.moveActiveTabBlocker()).toBeNull()
    layout.moveActiveTabToNextGroup()
    expect(workbench.store.getState().log.at(-1)).toMatchObject({
      type: 'layout.moveTab',
      status: 'applied',
    })
  })
})
