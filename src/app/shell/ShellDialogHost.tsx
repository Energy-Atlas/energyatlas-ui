import type { AppAction } from '../actions.ts'
import { CommandPalette } from './CommandPalette.tsx'
import { CapabilitiesDialog, ShortcutsDialog } from './HelpDialogs.tsx'
import type { OpenShellDialog } from './useShellDialogs.ts'

/** The command palette and help dialogs the menus open. */
export function ShellDialogHost({
  open,
  onOpenChange,
  actions,
  invoke,
}: {
  open: OpenShellDialog
  onOpenChange: (isOpen: boolean) => void
  actions: AppAction[]
  invoke: (action: AppAction) => void
}) {
  return (
    <>
      <CommandPalette
        isOpen={open === 'palette'}
        onOpenChange={onOpenChange}
        actions={actions}
        invoke={invoke}
      />
      <ShortcutsDialog
        isOpen={open === 'shortcuts'}
        onOpenChange={onOpenChange}
        actions={actions}
      />
      <CapabilitiesDialog
        isOpen={open === 'capabilities'}
        onOpenChange={onOpenChange}
      />
    </>
  )
}
