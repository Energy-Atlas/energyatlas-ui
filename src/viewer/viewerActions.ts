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
 * The viewer page's actions (decision 0032, stage 5): the shared registry
 * filtered to what a view-only page offers, plus opening packages, the
 * handover's provenance, and the reset to the handed-over layout. They drive
 * the ribbon menus, the command palette, and the shortcuts, as in the
 * modeller.
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
        ? 'Wait for the package being opened.'
        : null
    const noPackage = 'Open a handover package first.'
    const extras: AppAction[] = [
      {
        id: 'viewer.openFile',
        label: 'Open package file…',
        group: 'File',
        icon: FileUp,
        shortcut: 'Ctrl+O',
        disabledReason: busy,
        perform: pickPackageFile,
      },
      {
        id: 'viewer.packages',
        label: 'Handover packages…',
        group: 'File',
        icon: PackageOpen,
        disabledReason: handover ? busy : 'This is the list of packages.',
        perform: () => {
          void client.closeProject()
        },
      },
      {
        id: 'viewer.about',
        label: 'About this handover…',
        group: 'File',
        icon: Info,
        disabledReason: handover ? null : noPackage,
        perform: () => viewerStore.setState({ aboutOpen: true }),
      },
      {
        id: 'viewer.resetToHandover',
        label: 'Reset to handed-over layout',
        group: 'View',
        menuPath: ['Layouts'],
        icon: RotateCcw,
        disabledReason: handover ? null : noPackage,
        perform: () => {
          layouts.resetToHandedOver()
        },
      },
    ]
    return forViewer(base, (page) => layout.hasPage(page), extras)
  }, [base, client, layout, layouts, handover, pending, opening])
}

/** What the package list offers from the viewer's menus; the rest need a package. */
const START_IDS = new Set([
  'viewer.openFile',
  'view.fullScreen',
  'help.palette',
  'help.shortcuts',
  'help.capabilities',
  'help.demoConditions',
])

export function forViewerStart(actions: AppAction[]): AppAction[] {
  return actions.map((action) =>
    START_IDS.has(action.id) || action.id.startsWith('view.appearance.')
      ? action
      : {
          ...action,
          pressed: undefined,
          disabledReason:
            action.id === 'viewer.packages'
              ? 'This is the list of packages.'
              : 'Open a handover package first.',
        },
  )
}
