import {
  ArrowRightLeft,
  Ban,
  Columns2,
  Command,
  FilePlus,
  FolderTree,
  Info,
  ListChecks,
  LogOut,
  Maximize,
  MessageSquare,
  Monitor,
  Moon,
  PanelLeft,
  PanelLeftClose,
  PanelRight,
  PanelRightClose,
  Play,
  Redo2,
  RotateCcw,
  Save,
  ScanSearch,
  Sun,
  Undo2,
  UserRound,
  Workflow,
  type LucideIcon,
} from 'lucide-react'
import { useCallback, useMemo } from 'react'
import { capabilities } from '../domain/capabilities.ts'
import { stageRunBlocker } from '../domain/workflow.ts'
import { APPEARANCE_LIST } from './appearance/appearances.ts'
import {
  useLayoutVersion,
  useServices,
  useStageStates,
  useWorkbenchSnapshot,
} from './WorkbenchContext.tsx'
import { DEFAULT_PAGES, PAGES, type PageId } from './layout/layoutController.ts'
import { saveProject } from './persistence.ts'

// One registry of app actions drives the ribbon menus, quick buttons, command
// palette, and keyboard shortcuts, so they cannot drift apart. A disabled or
// planned action is never a silent no-op: invoking it records the reason.

/** Account actions live in the menu behind the ribbon's account button. */
export type ActionGroup = 'File' | 'Edit' | 'View' | 'Run' | 'Help' | 'Account'

/**
 * Where a menu action sits inside its menu, as desktop menus do: an empty path
 * is the top level, ['Panels'] a submenu, ['Appearance', 'Theme'] a submenu of
 * a submenu. The command palette ignores this and stays flat.
 */
export type MenuPath = string[]

export const ACTION_GROUPS: ActionGroup[] = [
  'File',
  'Edit',
  'View',
  'Run',
  'Help',
]

export type AppAction = {
  id: string
  label: string
  group: ActionGroup
  /** Groups this action into a submenu of its menu; the palette stays flat. */
  menuPath?: MenuPath
  icon?: LucideIcon
  shortcut?: string
  alternateShortcuts?: string[]
  /** Whether the shortcut also works while typing in a field. */
  allowInEditable?: boolean
  /** Explains why the action cannot run now; null when it can. */
  disabledReason: string | null
  /** Current on/off state for toggles. */
  pressed?: boolean
  perform: () => void
}

export type ShellDialogs = {
  openPalette: () => void
  openShortcuts: () => void
  openCapabilities: () => void
  openNewProject: () => void
}

const PAGE_SHORTCUTS: Partial<Record<PageId, string>> = Object.fromEntries(
  DEFAULT_PAGES.map((page, index) => [page, `Alt+${index + 1}`]),
)

export function useAppActions(dialogs: ShellDialogs): AppAction[] {
  const {
    workbench,
    layout,
    storage,
    appearancePreference,
    setAppearance,
    showInspection,
  } = useServices()
  const snapshot = useWorkbenchSnapshot((current) => current)
  const stageStates = useStageStates()
  const layoutVersion = useLayoutVersion()

  return useMemo(() => {
    void layoutVersion
    const { state, canUndo, canRedo } = snapshot
    const pendingCount = Object.keys(state.pendingEdits).length
    const currentStageId = state.workflow.currentStageId
    const currentBlocker = currentStageId
      ? stageRunBlocker(state.workflow, state.tasks, currentStageId)
      : 'No stage is focused.'
    const nextReady = state.workflow.stageIds.find(
      (id) => stageStates[id] === 'ready',
    )
    const activeTaskIds = state.taskIds.filter((id) => {
      const status = state.tasks[id]?.status
      return status === 'queued' || status === 'running'
    })
    const fullScreenAvailable =
      typeof document !== 'undefined' && document.fullscreenEnabled

    const actions: AppAction[] = [
      {
        id: 'file.save',
        label: 'Save project in this browser',
        group: 'File',
        icon: Save,
        shortcut: 'Ctrl+S',
        allowInEditable: true,
        disabledReason: storage
          ? null
          : 'Browser storage is unavailable, so the project cannot be saved here.',
        perform: () => {
          const result = saveProject(storage, workbench.getState(), new Date())
          if (result.ok) {
            workbench.record({
              type: 'project.save',
              title: 'Save project',
              summary: `Saved the project in this browser at ${new Date(result.savedAt).toLocaleTimeString()}.`,
            })
          } else {
            workbench.record({
              type: 'project.save',
              title: 'Save project',
              status: 'rejected',
              summary: '',
              issues: [{ path: '', message: result.message }],
            })
          }
        },
      },
      {
        id: 'file.new',
        label: 'New empty project…',
        group: 'File',
        icon: FilePlus,
        disabledReason: null,
        perform: dialogs.openNewProject,
      },
      {
        id: 'edit.undo',
        label: 'Undo',
        group: 'Edit',
        icon: Undo2,
        shortcut: 'Ctrl+Z',
        disabledReason: canUndo ? null : 'Nothing to undo.',
        perform: () => {
          workbench.undo()
        },
      },
      {
        id: 'edit.redo',
        label: 'Redo',
        group: 'Edit',
        icon: Redo2,
        shortcut: 'Ctrl+Shift+Z',
        alternateShortcuts: ['Ctrl+Y'],
        disabledReason: canRedo ? null : 'Nothing to redo.',
        perform: () => {
          workbench.redo()
        },
      },
      {
        id: 'edit.applyEdits',
        label: `Apply pending edits (${pendingCount})`,
        group: 'Edit',
        disabledReason: pendingCount > 0 ? null : 'There are no pending edits.',
        perform: () => {
          workbench.execute({ type: 'edits.apply', input: {} })
        },
      },
      {
        id: 'edit.discardEdits',
        label: 'Discard pending edits',
        group: 'Edit',
        disabledReason: pendingCount > 0 ? null : 'There are no pending edits.',
        perform: () => {
          workbench.execute({ type: 'edits.discard', input: {} })
        },
      },
      ...(Object.keys(PAGES) as PageId[]).map((page): AppAction => ({
        id: `view.open.${page}`,
        label: PAGES[page].name,
        group: 'View',
        menuPath: ['Panels'],
        shortcut: PAGE_SHORTCUTS[page],
        pressed: layout.isPageOpen(page),
        disabledReason: null,
        perform: () => layout.openPage(page),
      })),
      {
        id: 'view.toggleAssets',
        label: 'Assets',
        group: 'View',
        menuPath: ['Panels'],
        icon: FolderTree,
        shortcut: 'Ctrl+B',
        pressed: layout.isPanelOpen('assets'),
        disabledReason: null,
        perform: () => layout.togglePanel('assets'),
      },
      {
        id: 'view.toggleWorkflow',
        label: 'Workflow',
        group: 'View',
        menuPath: ['Panels'],
        icon: Workflow,
        shortcut: 'Ctrl+Shift+E',
        pressed: layout.isPanelOpen('workflow'),
        disabledReason: null,
        perform: () => layout.togglePanel('workflow'),
      },
      {
        id: 'view.toggleReasoning',
        label: 'Reasoning',
        group: 'View',
        menuPath: ['Panels'],
        icon: MessageSquare,
        shortcut: 'Ctrl+Alt+B',
        pressed: layout.isPanelOpen('reasoning'),
        disabledReason: null,
        perform: () => layout.togglePanel('reasoning'),
      },
      {
        id: 'view.toggleInspection',
        label: 'Inspection',
        group: 'View',
        menuPath: ['Panels'],
        icon: ScanSearch,
        shortcut: 'Ctrl+Alt+I',
        pressed: layout.isPanelOpen('inspection'),
        disabledReason: null,
        perform: () => layout.togglePanel('inspection'),
      },
      {
        id: 'view.toggleLeftSide',
        label: 'Collapse or expand the left side container',
        group: 'View',
        icon: layout.isSideOpen('left') ? PanelLeftClose : PanelLeft,
        pressed: layout.isSideOpen('left'),
        disabledReason: null,
        perform: () => layout.toggleSide('left'),
      },
      {
        id: 'view.toggleRightSide',
        label: 'Collapse or expand the right side container',
        group: 'View',
        icon: layout.isSideOpen('right') ? PanelRightClose : PanelRight,
        pressed: layout.isSideOpen('right'),
        disabledReason: null,
        perform: () => layout.toggleSide('right'),
      },
      {
        id: 'view.inspectSelection',
        label: 'Inspect selection',
        group: 'View',
        icon: ScanSearch,
        disabledReason:
          state.selection.ids.length > 0
            ? null
            : 'Nothing is selected. Select buildings or grid elements on the Map or Table page first.',
        perform: () => showInspection(),
      },
      {
        id: 'view.toggleMaximize',
        label: 'Maximize or restore tab group',
        group: 'View',
        icon: Maximize,
        shortcut: 'Ctrl+Shift+M',
        disabledReason: null,
        perform: () => layout.toggleMaximize(),
      },
      {
        id: 'view.resetLayout',
        label: 'Reset layout',
        group: 'View',
        menuPath: ['Appearance'],
        icon: RotateCcw,
        disabledReason: null,
        perform: () => layout.reset(),
      },
      {
        id: 'view.placeMapBesideTable',
        label: 'Place Map beside Table',
        group: 'View',
        icon: Columns2,
        disabledReason: null,
        perform: () => layout.placePage('map', 'table', 'right'),
      },
      {
        id: 'view.splitActiveTab',
        label: 'Split active tab to the right',
        group: 'View',
        disabledReason: layout.splitActiveTabBlocker(),
        perform: () => layout.splitActiveTab('right'),
      },
      {
        id: 'view.moveActiveTab',
        label: 'Move active tab to the next tab group',
        group: 'View',
        icon: ArrowRightLeft,
        disabledReason: layout.moveActiveTabBlocker(),
        perform: () => layout.moveActiveTabToNextGroup(),
      },
      {
        id: 'view.fullScreen',
        label: 'Toggle full screen',
        group: 'View',
        icon: Monitor,
        disabledReason: fullScreenAvailable
          ? null
          : 'Full screen is not available in this browser.',
        perform: () => {
          const request = document.fullscreenElement
            ? document.exitFullscreen()
            : document.documentElement.requestFullscreen()
          request.catch((error: unknown) => {
            workbench.record({
              type: 'view.fullScreen',
              title: 'Toggle full screen',
              status: 'rejected',
              summary: '',
              issues: [
                {
                  path: '',
                  message: `Full screen was refused: ${error instanceof Error ? error.message : String(error)}`,
                },
              ],
            })
          })
        },
      },
      {
        id: 'view.appearance.system',
        label: 'System',
        group: 'View',
        menuPath: ['Appearance', 'Theme'],
        icon: Monitor,
        pressed: appearancePreference === 'system',
        disabledReason: null,
        perform: () => setAppearance('system'),
      },
      ...APPEARANCE_LIST.map((appearance): AppAction => ({
        id: `view.appearance.${appearance.id}`,
        label: appearance.label,
        group: 'View',
        menuPath: ['Appearance', 'Theme'],
        icon: appearance.scheme === 'dark' ? Moon : Sun,
        pressed: appearancePreference === appearance.id,
        disabledReason: null,
        perform: () => setAppearance(appearance.id),
      })),
      {
        id: 'run.current',
        label: 'Run current stage',
        group: 'Run',
        icon: Play,
        shortcut: 'Ctrl+Enter',
        disabledReason: currentBlocker,
        perform: () => {
          if (currentStageId) {
            workbench.execute({
              type: 'workflow.runStage',
              input: { stageId: currentStageId },
            })
          }
        },
      },
      {
        id: 'run.nextReady',
        label: 'Run next ready stage',
        group: 'Run',
        icon: ListChecks,
        disabledReason: nextReady ? null : 'No stage is ready to run.',
        perform: () => {
          if (nextReady) {
            workbench.execute({
              type: 'workflow.runStage',
              input: { stageId: nextReady },
            })
          }
        },
      },
      {
        id: 'run.cancelTasks',
        label: 'Cancel running tasks',
        group: 'Run',
        icon: Ban,
        disabledReason:
          activeTaskIds.length > 0 ? null : 'No task is queued or running.',
        perform: () => {
          for (const taskId of activeTaskIds) {
            workbench.execute({ type: 'task.cancel', input: { taskId } })
          }
        },
      },
      {
        id: 'help.palette',
        label: 'Search commands…',
        group: 'Help',
        icon: Command,
        shortcut: 'Ctrl+K',
        allowInEditable: true,
        disabledReason: null,
        perform: dialogs.openPalette,
      },
      {
        id: 'help.shortcuts',
        label: 'Keyboard shortcuts',
        group: 'Help',
        disabledReason: null,
        perform: dialogs.openShortcuts,
      },
      {
        id: 'help.capabilities',
        label: 'What is working, simulated, or planned',
        group: 'Help',
        icon: Info,
        disabledReason: null,
        perform: dialogs.openCapabilities,
      },
      {
        id: 'help.comments',
        label: 'Comments (planned)',
        group: 'Help',
        icon: MessageSquare,
        disabledReason: `Planned: ${capabilities['ribbon.comments'].explanation}`,
        perform: () => undefined,
      },
      {
        id: 'account.settings',
        label: 'Account',
        group: 'Account',
        icon: UserRound,
        disabledReason: `Planned: ${capabilities['account.settings'].explanation}`,
        perform: () => undefined,
      },
      {
        id: 'account.logOut',
        label: 'Log out',
        group: 'Account',
        icon: LogOut,
        disabledReason: `Planned: ${capabilities['account.signIn'].explanation}`,
        perform: () => undefined,
      },
    ]
    return actions
  }, [
    snapshot,
    stageStates,
    layoutVersion,
    workbench,
    layout,
    storage,
    appearancePreference,
    setAppearance,
    showInspection,
    dialogs,
  ])
}

export function useInvokeAction(): (action: AppAction) => void {
  const { workbench } = useServices()
  return useCallback(
    (action: AppAction) => {
      if (action.disabledReason) {
        workbench.record({
          type: `action.${action.id}`,
          title: action.label,
          status: 'rejected',
          summary: '',
          issues: [{ path: '', message: action.disabledReason }],
        })
        return
      }
      action.perform()
    },
    [workbench],
  )
}
