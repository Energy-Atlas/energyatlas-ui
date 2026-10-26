import {
  ArrowRightLeft,
  Ban,
  Columns2,
  Command,
  FilePlus,
  FolderTree,
  FlaskConical,
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
import { useStore } from 'zustand'
import { capabilities } from '../domain/capabilities.ts'
import { stageRunBlocker } from '../domain/workflow.ts'
import { APPEARANCE_LIST } from './appearance/appearances.ts'
import {
  useClientSnapshot,
  useLayoutVersion,
  useServices,
  useStageStates,
  useViewState,
  useWorkbenchSnapshot,
} from './WorkbenchContext.tsx'
import { freshRunAndSelect, retryAndSelect } from './pages/jobs/jobActions.ts'
import {
  cancelBlocker,
  freshRunBlocker,
  retryActionBlocker,
  shownJob,
} from './pages/jobs/jobView.ts'
import { DEFAULT_PAGES, PAGES, type PageId } from './layout/layoutController.ts'

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
  openDemoConditions: () => void
}

const PAGE_SHORTCUTS: Partial<Record<PageId, string>> = Object.fromEntries(
  DEFAULT_PAGES.map((page, index) => [page, `Alt+${index + 1}`]),
)

export function useAppActions(dialogs: ShellDialogs): AppAction[] {
  const {
    workbench,
    client,
    lifecycle,
    layout,
    storage,
    appearancePreference,
    setAppearance,
    showInspection,
  } = useServices()
  const snapshot = useWorkbenchSnapshot((current) => current)
  const pending = useClientSnapshot((current) => current.pending)
  const transitioning = useClientSnapshot((current) => current.transitioning)
  const lifecycleBusy = useStore(
    lifecycle.store,
    (current) => current.busy || current.guard !== null,
  )
  const guarded = useStore(lifecycle.store, (current) => current.guard !== null)
  const stageStates = useStageStates()
  const layoutVersion = useLayoutVersion()
  const view = useServices().view
  const jobsView = useViewState((current) => current.jobs)

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
    /** Why a request of this type must wait for the previous one, or null. */
    const awaiting = (type: string, what: string): string | null =>
      pending.some((request) => request.type === type)
        ? `Waiting for the server to answer: ${what}.`
        : null

    const actions: AppAction[] = [
      {
        id: 'file.save',
        label: 'Save project in this browser',
        group: 'File',
        icon: Save,
        shortcut: 'Ctrl+S',
        allowInEditable: true,
        disabledReason: storage
          ? awaiting('project.save', 'the project is being saved')
          : 'Browser storage is unavailable, so the project cannot be saved here.',
        perform: () => {
          void lifecycle.request({ type: 'save' })
        },
      },
      {
        id: 'file.new',
        label: 'New project…',
        group: 'File',
        icon: FilePlus,
        disabledReason: null,
        perform: dialogs.openNewProject,
      },
      {
        id: 'file.openProject',
        label: 'Open project…',
        group: 'File',
        shortcut: 'Ctrl+O',
        disabledReason: null,
        perform: () => lifecycle.openCatalog(),
      },
      {
        id: 'file.projects',
        label: 'Projects…',
        group: 'File',
        disabledReason: null,
        perform: () => {
          void lifecycle.request({ type: 'close' })
        },
      },
      {
        id: 'edit.undo',
        label: 'Undo',
        group: 'Edit',
        icon: Undo2,
        shortcut: 'Ctrl+Z',
        disabledReason:
          awaiting('edits.apply', 'drafts are being applied') ??
          (canUndo ? null : 'Nothing to undo.'),
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
        disabledReason:
          awaiting('edits.apply', 'drafts are being applied') ??
          (canRedo ? null : 'Nothing to redo.'),
        perform: () => {
          workbench.redo()
        },
      },
      {
        id: 'edit.applyEdits',
        label: `Apply pending edits (${pendingCount})`,
        group: 'Edit',
        disabledReason:
          pendingCount > 0
            ? awaiting('edits.apply', 'the edits are being applied')
            : 'There are no pending edits.',
        perform: () => {
          void client.execute({ type: 'edits.apply', input: {} })
        },
      },
      {
        id: 'edit.discardEdits',
        label: 'Discard pending edits',
        group: 'Edit',
        disabledReason:
          pendingCount > 0
            ? awaiting('edits.apply', 'the edits are being applied')
            : 'There are no pending edits.',
        perform: () => {
          void client.execute({ type: 'edits.discard', input: {} })
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
            void client.execute({
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
            void client.execute({
              type: 'workflow.runStage',
              input: { stageId: nextReady },
            })
          }
        },
      },
      {
        id: 'run.cancelTasks',
        label: 'Cancel running jobs',
        group: 'Run',
        icon: Ban,
        disabledReason:
          activeTaskIds.length > 0 ? null : 'No job is created or running.',
        perform: () => {
          for (const taskId of activeTaskIds) {
            void client.execute({ type: 'task.cancel', input: { taskId } })
          }
        },
      },
      ...(() => {
        const job = shownJob(state, jobsView.selectedTaskId, jobsView.filter)
        const none = 'No job is selected. Open Jobs and select one.'
        const services = { client, workbench, view }
        return [
          {
            id: 'jobs.retrySelected',
            label: 'Retry selected job',
            group: 'Run' as const,
            icon: RotateCcw,
            disabledReason: job
              ? retryActionBlocker(state, job, pending)
              : none,
            perform: () => {
              if (job) void retryAndSelect(services, job.id)
            },
          },
          {
            id: 'jobs.freshRunSelected',
            label: "Fresh run of selected job's stage",
            group: 'Run' as const,
            disabledReason: job ? freshRunBlocker(state, job, pending) : none,
            perform: () => {
              if (job) void freshRunAndSelect(services, job.stageId)
            },
          },
          {
            id: 'jobs.cancelSelected',
            label: 'Cancel selected job',
            group: 'Run' as const,
            disabledReason: job ? cancelBlocker(job, pending) : none,
            perform: () => {
              if (job) {
                void client.execute({
                  type: 'task.cancel',
                  input: { taskId: job.id },
                })
              }
            },
          },
        ]
      })(),
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
        id: 'help.demoConditions',
        label: 'Demo conditions…',
        group: 'Help',
        icon: FlaskConical,
        disabledReason: null,
        perform: dialogs.openDemoConditions,
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
        id: 'account.open',
        label: 'Account',
        group: 'Account',
        icon: UserRound,
        disabledReason: null,
        perform: () => layout.openPage('account'),
      },
      {
        id: 'account.logOut',
        label: 'Log out',
        group: 'Account',
        icon: LogOut,
        disabledReason: null,
        // Nobody is signed in, so the reason goes to the status bar rather
        // than under the menu item.
        perform: () => {
          workbench.record({
            type: 'account.logOut',
            title: 'Log out',
            status: 'rejected',
            summary: '',
            issues: [
              {
                path: '',
                message: `Planned: ${capabilities['account.signIn'].explanation}`,
              },
            ],
          })
        },
      },
    ]
    return actions.map((action) =>
      (action.group === 'File' && lifecycleBusy) ||
      (['Edit', 'Run'].includes(action.group) && (guarded || transitioning))
        ? {
            ...action,
            disabledReason:
              'Finish or cancel the current project transition first.',
          }
        : action,
    )
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
    client,
    lifecycle,
    pending,
    dialogs,
    lifecycleBusy,
    guarded,
    transitioning,
    view,
    jobsView,
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
