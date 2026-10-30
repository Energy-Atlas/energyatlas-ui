import { FileUp, Info, PackageOpen, RotateCcw } from 'lucide-react'
import { useMemo } from 'react'
import { useStore } from 'zustand'
import { useClientSnapshot, useServices } from '../app/WorkbenchContext.tsx'
import {
  forViewer,
  useAppActions,
  type AppAction,
  type ShellDialogs,
} from '../app/actions.ts'
import { pickPackageFile, viewerStore } from './viewerStore.ts'

/**
 * The viewer page's actions (decision 0032, stage 5; decision 0036): the
 * shared registry with everything a view cannot do shown unavailable with its
 * reason, plus opening views, the view's provenance, and the reset to the
 * view's layout. They drive the ribbon menus, the command palette, and the
 * shortcuts, as in the modeller.
 */
export function useViewerActions(dialogs: ShellDialogs): AppAction[] {
  const { client, layout, layouts } = useServices()
  const base = useAppActions(dialogs)
  const handover = useClientSnapshot((snapshot) => snapshot.meta.handover)
  const pending = useClientSnapshot((snapshot) => snapshot.pending)
  const opening = useStore(viewerStore, (state) => state.opening)
  return useMemo(() => {
    const busy =
      opening !== null ||
      pending.some(
        (request) =>
          request.type === 'handover.open' || request.type === 'project.close',
      )
        ? 'Wait for the view being opened.'
        : null
    const noView = 'Open a view first.'
    const extras: AppAction[] = [
      {
        id: 'viewer.openFile',
        label: 'Open view file…',
        group: 'File',
        icon: FileUp,
        shortcut: 'Ctrl+O',
        disabledReason: busy,
        perform: pickPackageFile,
      },
      {
        id: 'viewer.packages',
        label: 'Views…',
        group: 'File',
        icon: PackageOpen,
        disabledReason: handover ? busy : 'This is the list of views.',
        perform: () => {
          void client.closeProject()
        },
      },
      {
        id: 'viewer.about',
        label: 'About this view…',
        group: 'File',
        icon: Info,
        disabledReason: handover ? null : noView,
        perform: () => viewerStore.setState({ aboutOpen: true }),
      },
      {
        id: 'viewer.resetToHandover',
        label: "Reset to the view's layout",
        group: 'View',
        menuPath: ['Layouts'],
        icon: RotateCcw,
        disabledReason: handover ? null : noView,
        perform: () => {
          layouts.resetToHandedOver()
        },
      },
    ]
    return forViewer(base, (page) => layout.hasPage(page), extras)
  }, [base, client, layout, layouts, handover, pending, opening])
}

/** What the start page offers from the viewer's menus; the rest need a view. */
const START_IDS = new Set([
  'viewer.openFile',
  'view.fullScreen',
  'help.palette',
  'help.shortcuts',
  'help.capabilities',
  'help.demoConditions',
  'account.logOut',
])

export function forViewerStart(actions: AppAction[]): AppAction[] {
  return actions.map((action) =>
    START_IDS.has(action.id) ||
    action.id.startsWith('view.appearance.') ||
    // Already unavailable in every view, with its own reason.
    action.disabledReason !== null
      ? action
      : {
          ...action,
          pressed: undefined,
          disabledReason:
            action.id === 'viewer.packages'
              ? 'This is the list of views.'
              : 'Open a view first.',
        },
  )
}
