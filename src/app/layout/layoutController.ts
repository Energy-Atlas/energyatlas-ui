import {
  Actions,
  BorderNode,
  DockLocation,
  Model,
  TabGroupNode,
  TabNode,
  TabSetNode,
  type Action,
  type IJsonModel,
  type IJsonTabNode,
} from 'flexlayout-react'
import type { CommandSource } from '../../domain/types.ts'
import type { Workbench } from '../../domain/workbench.ts'

// Wraps the FlexLayout model (decisions 0004 and 0008). Layout state stays out
// of project state, but every deliberate layout change is a typed operation
// recorded in the workbench log, so manual controls and the agent share it.

export const PAGES = {
  map: { name: 'Map', component: 'page.map' },
  table: { name: 'Table', component: 'page.table' },
  dashboard: { name: 'Dashboard', component: 'page.dashboard' },
  roadmap: { name: 'Roadmap', component: 'page.roadmap' },
  creator: { name: 'Creator', component: 'page.creator' },
  settings: { name: 'Settings', component: 'page.settings' },
  issues: { name: 'Issues', component: 'page.issues' },
  // Tasks became Jobs (decision 0023); the component id stays page.tasks.
  tasks: { name: 'Jobs', component: 'page.tasks' },
  intake: { name: 'Data intake', component: 'page.intake' },
  archetypes: { name: 'Archetypes', component: 'page.archetypes' },
  calibration: { name: 'Calibration', component: 'page.calibration' },
  account: { name: 'Account', component: 'page.account' },
} as const

export const PANELS = {
  assets: { name: 'Assets', component: 'panel.assets' },
  workflow: { name: 'Workflow', component: 'panel.workflow' },
  // Reasoning keeps the panel.reasoning component id through both renames
  // (Reasoning, Context, Reasoning again) so saved layouts still restore.
  reasoning: { name: 'Reasoning', component: 'panel.reasoning' },
  inspection: { name: 'Inspection', component: 'panel.inspection' },
} as const

export type PageId = keyof typeof PAGES
export type PanelId = keyof typeof PANELS

export type DockSide = 'left' | 'right' | 'top' | 'bottom'

const DOCK_LOCATIONS: Record<DockSide, DockLocation> = {
  left: DockLocation.LEFT,
  right: DockLocation.RIGHT,
  top: DockLocation.TOP,
  bottom: DockLocation.BOTTOM,
}

const SIDE_PHRASES: Record<DockSide, string> = {
  left: 'to the left of',
  right: 'to the right of',
  top: 'above',
  bottom: 'below',
}

export const DEFAULT_PAGES: PageId[] = [
  'map',
  'table',
  'dashboard',
  'roadmap',
  'creator',
  'settings',
]

export const MAIN_TABSET_ID = 'tabset:main'
// v2 splits the Context panel into Reasoning and Inspection (decision 0016);
// a v1 layout has no Inspection tab, so it is not restored.
const LAYOUT_KEY = 'eaui.layout.v2'

export function pageTabId(page: PageId): string {
  return `page:${page}`
}

export function panelTabId(panel: PanelId): string {
  return `panel:${panel}`
}

function pageTab(page: PageId): IJsonTabNode {
  return {
    type: 'tab',
    id: pageTabId(page),
    name: PAGES[page].name,
    component: PAGES[page].component,
  }
}

/** Panels can be closed from their ribbon tab; togglePanel docks them back. */
function panelTab(panel: PanelId): IJsonTabNode {
  return {
    type: 'tab',
    id: panelTabId(panel),
    name: PANELS[panel].name,
    component: PANELS[panel].component,
  }
}

/** The side a panel returns to when it is reopened after being closed. */
const PANEL_HOME: Record<PanelId, 'left' | 'right'> = {
  assets: 'left',
  workflow: 'left',
  reasoning: 'right',
  inspection: 'right',
}

export function createDefaultLayout(): IJsonModel {
  return {
    global: {
      // Keep panels mounted so maps and charts keep their state when hidden.
      tabEnableRenderOnDemand: false,
      tabEnablePopout: false,
      tabEnableFloat: false,
      // Both side ribbons read top to bottom, with icons rotated to match.
      enableRotateBorderIcons: true,
      borderLeftTabDirection: 'down',
      // Side containers stay in place when empty so panels can be docked back.
      borderEnableAutoHide: false,
      borderMinSize: 180,
      // Hovering scrollbars over the content instead of reserved gutters.
      tabEnableScrollbars: true,
      borderEnableTabScrollbar: true,
    },
    borders: [
      {
        type: 'border',
        location: 'left',
        size: 280,
        selected: 0,
        children: [panelTab('assets'), panelTab('workflow')],
      },
      {
        type: 'border',
        location: 'right',
        size: 320,
        selected: 0,
        children: [panelTab('reasoning'), panelTab('inspection')],
      },
    ],
    layout: {
      type: 'row',
      children: [
        {
          type: 'tabset',
          id: MAIN_TABSET_ID,
          weight: 100,
          selected: 0,
          enableDeleteWhenEmpty: false,
          children: DEFAULT_PAGES.map(pageTab),
        },
      ],
    },
  }
}

export type LayoutController = {
  getModel: () => Model
  /** Increments on every layout change, for useSyncExternalStore. */
  getVersion: () => number
  subscribe: (listener: () => void) => () => void
  openPage: (page: PageId, source?: CommandSource) => void
  /** Whether the page is on screen, wherever it is docked. */
  isPageOpen: (page: PageId) => boolean
  togglePanel: (panel: PanelId, source?: CommandSource) => void
  /** Whether the panel is on screen, wherever it is docked. */
  isPanelOpen: (panel: PanelId) => boolean
  /** Collapses or expands a whole side container, whatever it holds. */
  toggleSide: (side: 'left' | 'right', source?: CommandSource) => void
  isSideOpen: (side: 'left' | 'right') => boolean
  toggleMaximize: (source?: CommandSource) => void
  /** Narrow windows open side panels as overlays so pages keep their width. */
  setCompact: (compact: boolean, source?: CommandSource) => void
  reset: (source?: CommandSource) => void
  /** Places a page in a new tab group beside another page, opening either if needed. */
  placePage: (
    page: PageId,
    beside: PageId,
    side?: DockSide,
    source?: CommandSource,
  ) => void
  /** Keyboard docking: why the active tab cannot be split off, or null. */
  splitActiveTabBlocker: () => string | null
  /** Keyboard docking: why the active tab cannot move to another group, or null. */
  moveActiveTabBlocker: () => string | null
  splitActiveTab: (side?: DockSide, source?: CommandSource) => void
  moveActiveTabToNextGroup: (source?: CommandSource) => void
  /** FlexLayout onAction hook: logs meaningful manual layout changes. */
  handleUserAction: (action: Action) => Action
}

// FlexLayout does not export BorderNode's type; this is the part the controller uses.
type BorderLike = {
  getId: () => string
  getBorderType: () => 'split' | 'overlay'
  getSelectedNode: () => TabNode | undefined
  getSelected: () => number
  getTabNodes: () => TabNode[]
  getLocation: () => { getName: () => string }
}

/** Saved layouts store tab names; renamed pages and panels take their current name. */
function withCurrentPanelNames(model: Model): Model {
  const tabs: [string, string][] = [
    ...(Object.keys(PAGES) as PageId[]).map((page): [string, string] => [
      pageTabId(page),
      PAGES[page].name,
    ]),
    ...(Object.keys(PANELS) as PanelId[]).map((panel): [string, string] => [
      panelTabId(panel),
      PANELS[panel].name,
    ]),
  ]
  for (const [id, name] of tabs) {
    const node = model.getNodeById(id)
    if (node instanceof TabNode && node.getName() !== name) {
      model.doAction(Actions.renameTab(node.getId(), name))
    }
  }
  return model
}

function restoreModel(storage: Storage | null): Model {
  try {
    const raw = storage?.getItem(LAYOUT_KEY)
    if (raw) {
      return withCurrentPanelNames(
        Model.fromJson(JSON.parse(raw) as IJsonModel),
      )
    }
  } catch {
    // Unreadable or incompatible saved layout: fall back to the default.
  }
  return Model.fromJson(createDefaultLayout())
}

export function createLayoutController(
  workbench: Workbench,
  storage: Storage | null,
): LayoutController {
  let version = 0
  const listeners = new Set<() => void>()
  let model = restoreModel(storage)

  const handleChange = () => {
    version += 1
    try {
      storage?.setItem(LAYOUT_KEY, JSON.stringify(model.toJson()))
    } catch {
      // Storage is blocked; the layout persists for this session only.
    }
    for (const listener of listeners) listener()
  }
  model.addChangeListener(handleChange)

  const log = (
    type: string,
    title: string,
    input: unknown,
    summary: string,
    source: CommandSource,
  ) => {
    workbench.record({ type, title, input, summary, source })
  }

  const reject = (
    type: string,
    title: string,
    input: unknown,
    message: string,
    source: CommandSource,
  ) => {
    workbench.record({
      type,
      title,
      input,
      source,
      status: 'rejected',
      summary: '',
      issues: [{ path: '', message }],
    })
  }

  const panelBorders = (): BorderLike[] => {
    const borders = new Map<string, BorderLike>()
    for (const panel of Object.keys(PANELS) as PanelId[]) {
      const parent = model.getNodeById(panelTabId(panel))?.getParent()
      if (parent?.getType() === 'border') {
        borders.set(parent.getId(), parent as unknown as BorderLike)
      }
    }
    return [...borders.values()]
  }

  /** The border on a side, for docking panels back and collapsing the container. */
  const sideBorder = (location: 'left' | 'right'): BorderLike | undefined => {
    let found: BorderLike | undefined
    model.visitNodes((node) => {
      const candidate = node as unknown as BorderLike
      if (
        node.getType() === 'border' &&
        candidate.getLocation().getName() === location
      ) {
        found = candidate
      }
    })
    return found
  }

  const borderByLocation = (location: 'left' | 'right'): string | undefined =>
    sideBorder(location)?.getId()

  const ensurePageTab = (page: PageId): TabNode | null => {
    const existing = model.getNodeById(pageTabId(page))
    if (existing instanceof TabNode) return existing
    const target =
      model.getNodeById(MAIN_TABSET_ID) ??
      model.getActiveTabset() ??
      model.getFirstTabSet()
    if (!(target instanceof TabSetNode)) return null
    model.doAction(
      Actions.addNode(
        pageTab(page),
        target.getId(),
        DockLocation.CENTER,
        -1,
        false,
      ),
    )
    const added = model.getNodeById(pageTabId(page))
    return added instanceof TabNode ? added : null
  }

  const activeTab = (): { tabset: TabSetNode; tab: TabNode } | null => {
    const tabset = model.getActiveTabset() ?? model.getNodeById(MAIN_TABSET_ID)
    if (!(tabset instanceof TabSetNode)) return null
    const tab = tabset.getSelectedNode()
    return tab instanceof TabNode ? { tabset, tab } : null
  }

  const tabsets = (): TabSetNode[] => {
    const found: TabSetNode[] = []
    model.visitNodes((node) => {
      if (node instanceof TabSetNode) found.push(node)
    })
    return found
  }

  /** The tab set or border holding a tab, looking through tab groups. */
  const tabContainer = (node: TabNode) => {
    const parent = node.getParent()
    return parent instanceof TabGroupNode ? parent.getParent() : parent
  }

  /**
   * On screen: selected in its tab set or border, and hidden neither by
   * another maximized tab set nor by a hidden border.
   */
  const isTabVisible = (id: string): boolean => {
    const node = model.getNodeById(id)
    if (!(node instanceof TabNode) || !node.isSelected()) return false
    const container = tabContainer(node)
    if (container instanceof BorderNode) return container.isShowing()
    const maximized = model.getMaximizedTabset()
    return !maximized || maximized === container
  }

  /** Brings a docked tab on screen, restoring a maximized tab set that hides it. */
  const revealTab = (node: TabNode) => {
    const container = tabContainer(node)
    const maximized = model.getMaximizedTabset()
    if (
      container instanceof TabSetNode &&
      maximized &&
      maximized !== container
    ) {
      model.doAction(Actions.maximizeToggle(maximized.getId()))
    }
    // Selecting an already selected border tab would close it.
    if (!node.isSelected()) model.doAction(Actions.selectTab(node.getId()))
  }

  const NO_ACTIVE_TAB = 'No tab is active. Select a tab in a tab group first.'

  const splitActiveTabBlocker = (): string | null => {
    const active = activeTab()
    if (!active) return NO_ACTIVE_TAB
    if (active.tabset.getChildren().length < 2) {
      return `"${active.tab.getName()}" is the only tab in its group, so there is nothing to split it from.`
    }
    return null
  }

  const moveActiveTabBlocker = (): string | null => {
    if (!activeTab()) return NO_ACTIVE_TAB
    if (tabsets().length < 2) {
      return 'There is only one tab group. Split a tab into a new group first.'
    }
    return null
  }

  const tabName = (id: unknown): string => {
    const node = typeof id === 'string' ? model.getNodeById(id) : undefined
    return node instanceof TabNode ? `"${node.getName()}"` : 'a tab'
  }

  return {
    getModel: () => model,
    getVersion: () => version,
    subscribe: (listener) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },

    openPage: (page, source = 'manual') => {
      const id = pageTabId(page)
      const existing = model.getNodeById(id)
      if (existing instanceof TabNode) {
        revealTab(existing)
      } else {
        const target =
          model.getNodeById(MAIN_TABSET_ID) ??
          model.getActiveTabset() ??
          model.getFirstTabSet()
        if (!(target instanceof TabSetNode)) {
          reject(
            'layout.openPage',
            'Open page',
            { page },
            'No tab group is available. Reset the layout.',
            source,
          )
          return
        }
        model.doAction(
          Actions.addNode(
            pageTab(page),
            target.getId(),
            DockLocation.CENTER,
            -1,
            true,
          ),
        )
      }
      log(
        'layout.openPage',
        'Open page',
        { page },
        `Opened the ${PAGES[page].name} page.`,
        source,
      )
    },

    togglePanel: (panel, source = 'manual') => {
      const id = panelTabId(panel)
      const node = model.getNodeById(id)
      if (!(node instanceof TabNode)) {
        // The panel was closed from its ribbon: dock it back on its own side.
        const home = borderByLocation(PANEL_HOME[panel])
        if (!home) {
          reject(
            'layout.togglePanel',
            'Toggle panel',
            { panel },
            `The ${PANELS[panel].name} panel is not in this layout. Reset the layout.`,
            source,
          )
          return
        }
        model.doAction(
          Actions.addNode(panelTab(panel), home, DockLocation.CENTER, -1, true),
        )
        log(
          'layout.togglePanel',
          'Toggle panel',
          { panel },
          `Docked the ${PANELS[panel].name} panel back on the ${PANEL_HOME[panel]} side.`,
          source,
        )
        return
      }
      const name = PANELS[panel].name
      if (!isTabVisible(id)) {
        revealTab(node)
        log(
          'layout.togglePanel',
          'Toggle panel',
          { panel },
          `Showed the ${name} panel.`,
          source,
        )
        return
      }
      if (node.isInsideTabSet()) {
        // A tab set always shows one of its tabs, so a panel docked among the
        // pages is hidden by closing it; showing it again docks it back home.
        model.doAction(Actions.deleteTab(id))
        log(
          'layout.togglePanel',
          'Toggle panel',
          { panel },
          `Closed the ${name} panel. Showing it again docks it on the ${PANEL_HOME[panel]} side.`,
          source,
        )
        return
      }
      model.doAction(Actions.selectTab(id))
      log(
        'layout.togglePanel',
        'Toggle panel',
        { panel },
        `Hid the ${name} panel.`,
        source,
      )
    },

    isPageOpen: (page) => isTabVisible(pageTabId(page)),
    isPanelOpen: (panel) => isTabVisible(panelTabId(panel)),

    isSideOpen: (side) => (sideBorder(side)?.getSelected() ?? -1) >= 0,

    toggleSide: (side, source = 'manual') => {
      const border = sideBorder(side)
      const tabs = border?.getTabNodes() ?? []
      const selected = border?.getSelected() ?? -1
      // Collapsing selects nothing; expanding brings back the last tab shown.
      const target = selected >= 0 ? tabs[selected] : (tabs[0] ?? null)
      if (!border || !target) {
        reject(
          'layout.toggleSide',
          'Collapse or expand side container',
          { side },
          `The ${side} side container is empty. Drag a tab onto it first.`,
          source,
        )
        return
      }
      model.doAction(Actions.selectTab(target.getId()))
      log(
        'layout.toggleSide',
        'Collapse or expand side container',
        { side },
        selected >= 0
          ? `Collapsed the ${side} side container.`
          : `Expanded the ${side} side container.`,
        source,
      )
    },

    toggleMaximize: (source = 'manual') => {
      const tabset =
        model.getActiveTabset() ?? model.getNodeById(MAIN_TABSET_ID)
      if (!(tabset instanceof TabSetNode)) {
        reject(
          'layout.toggleMaximize',
          'Maximize or restore',
          {},
          'No tab group is active.',
          source,
        )
        return
      }
      model.doAction(Actions.maximizeToggle(tabset.getId()))
      log(
        'layout.toggleMaximize',
        'Maximize or restore',
        { tabsetId: tabset.getId() },
        model.getMaximizedTabset()
          ? 'Maximized the active tab group.'
          : 'Restored the tab layout.',
        source,
      )
    },

    setCompact: (compact, source = 'system') => {
      const borderType = compact ? 'overlay' : 'split'
      const changing = panelBorders().filter(
        (border) => border.getBorderType() !== borderType,
      )
      if (changing.length === 0) return
      for (const border of changing) {
        const selected = border.getSelectedNode()
        // Close open panels so an overlay does not cover the pages on arrival.
        if (compact && selected)
          model.doAction(Actions.selectTab(selected.getId()))
        model.doAction(Actions.setBorderType(border.getId(), borderType))
      }
      log(
        'layout.setCompact',
        'Adapt layout to window width',
        { compact },
        compact
          ? 'Narrow window: side panels now open as overlays over the pages.'
          : 'Wide window: side panels are docked beside the pages again.',
        source,
      )
    },

    reset: (source = 'manual') => {
      model.removeChangeListener(handleChange)
      model = Model.fromJson(createDefaultLayout())
      model.addChangeListener(handleChange)
      handleChange()
      log(
        'layout.reset',
        'Reset layout',
        {},
        'Restored the default workbench layout.',
        source,
      )
    },

    placePage: (page, beside, side = 'right', source = 'manual') => {
      const input = { page, beside, side }
      const title = 'Place page beside another'
      if (page === beside) {
        reject(
          'layout.placePage',
          title,
          input,
          'Choose two different pages.',
          source,
        )
        return
      }
      const besideTab = ensurePageTab(beside)
      const pageNode = ensurePageTab(page)
      const besideTabset = besideTab?.getParent()
      if (!pageNode || !(besideTabset instanceof TabSetNode)) {
        reject(
          'layout.placePage',
          title,
          input,
          `The ${PAGES[beside].name} page is not in a tab group. Reset the layout.`,
          source,
        )
        return
      }
      model.doAction(
        Actions.moveNode(
          pageTabId(page),
          besideTabset.getId(),
          DOCK_LOCATIONS[side],
          -1,
          true,
        ),
      )
      // Keep the page it was placed beside visible as well.
      const besideAfter = model.getNodeById(pageTabId(beside))
      if (besideAfter instanceof TabNode && !besideAfter.isSelected()) {
        model.doAction(Actions.selectTab(besideAfter.getId()))
      }
      log(
        'layout.placePage',
        title,
        input,
        `Placed the ${PAGES[page].name} page ${SIDE_PHRASES[side]} the ${PAGES[beside].name} page.`,
        source,
      )
    },

    splitActiveTabBlocker,
    moveActiveTabBlocker,

    splitActiveTab: (side = 'right', source = 'manual') => {
      const title = 'Split tab into a new group'
      const blocker = splitActiveTabBlocker()
      const active = activeTab()
      if (blocker || !active) {
        reject(
          'layout.splitTab',
          title,
          { side },
          blocker ?? NO_ACTIVE_TAB,
          source,
        )
        return
      }
      model.doAction(
        Actions.moveNode(
          active.tab.getId(),
          active.tabset.getId(),
          DOCK_LOCATIONS[side],
          -1,
          true,
        ),
      )
      log(
        'layout.splitTab',
        title,
        { tabId: active.tab.getId(), side },
        `Moved "${active.tab.getName()}" into a new tab group ${SIDE_PHRASES[side]} its previous group.`,
        source,
      )
    },

    moveActiveTabToNextGroup: (source = 'manual') => {
      const title = 'Move tab to next group'
      const blocker = moveActiveTabBlocker()
      const active = activeTab()
      if (blocker || !active) {
        reject('layout.moveTab', title, {}, blocker ?? NO_ACTIVE_TAB, source)
        return
      }
      const groups = tabsets()
      const index = groups.findIndex(
        (group) => group.getId() === active.tabset.getId(),
      )
      const target = groups[(index + 1) % groups.length]
      if (!target) {
        reject('layout.moveTab', title, {}, NO_ACTIVE_TAB, source)
        return
      }
      model.doAction(
        Actions.moveNode(
          active.tab.getId(),
          target.getId(),
          DockLocation.CENTER,
          -1,
          true,
        ),
      )
      log(
        'layout.moveTab',
        title,
        { tabId: active.tab.getId(), to: target.getId() },
        `Moved "${active.tab.getName()}" to the next tab group.`,
        source,
      )
    },

    handleUserAction: (action) => {
      const data = action.data as Record<string, unknown>
      switch (action.type) {
        case Actions.SELECT_TAB:
          log(
            'layout.selectTab',
            'Select tab',
            data,
            `Selected ${tabName(data.tabNode)}.`,
            'manual',
          )
          break
        case Actions.MOVE_NODE:
          log(
            'layout.moveTab',
            'Move tab',
            data,
            `Moved ${tabName(data.fromNode)}.`,
            'manual',
          )
          break
        case Actions.DELETE_TAB:
          log(
            'layout.closeTab',
            'Close tab',
            data,
            `Closed ${tabName(data.node)}.`,
            'manual',
          )
          break
        case Actions.MAXIMIZE_TOGGLE:
          log(
            'layout.toggleMaximize',
            'Maximize or restore',
            data,
            'Toggled the maximized tab group.',
            'manual',
          )
          break
        default:
          // Focus changes and resizing are not logged to keep the log meaningful.
          break
      }
      return action
    },
  }
}
