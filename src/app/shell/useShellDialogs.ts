import { useCallback, useMemo, useState } from 'react'
import { useServices } from '../WorkbenchContext.tsx'
import type { ShellDialogs } from '../actions.ts'
import { openDemoPanel } from './demoSwitchStore.ts'

export type OpenShellDialog = 'palette' | 'shortcuts' | 'capabilities' | null

/**
 * The dialogs the menus open, shared by the workbench and the start screen.
 * Demo conditions open the floating demo switch's panel (decision 0028).
 */
export function useShellDialogs() {
  const { lifecycle } = useServices()
  const [open, setOpen] = useState<OpenShellDialog>(null)
  const dialogs = useMemo<ShellDialogs>(
    () => ({
      openPalette: () => setOpen('palette'),
      openShortcuts: () => setOpen('shortcuts'),
      openCapabilities: () => setOpen('capabilities'),
      openNewProject: () => lifecycle.openCreate(),
      openDemoConditions: openDemoPanel,
    }),
    [lifecycle],
  )
  const onOpenChange = useCallback((isOpen: boolean) => {
    if (!isOpen) setOpen(null)
  }, [])
  return { open, dialogs, onOpenChange }
}
