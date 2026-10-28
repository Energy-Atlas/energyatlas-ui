import { useStore } from 'zustand'
import { useServices } from '../WorkbenchContext.tsx'
import { DialogFrame } from '../shell/HelpDialogs.tsx'
import { SaveLayoutForm } from './LayoutsPanel.tsx'
import {
  closeSaveLayoutPrompt,
  layoutsPanelStore,
} from './layoutsPanelStore.ts'

/**
 * View > Layouts > Save layout… (decision 0033): asks for a name, then saves
 * the current panels and views with the project, as the Layouts panel's own
 * form does.
 */
export function SaveLayoutPrompt() {
  const { layouts } = useServices()
  const open = useStore(layoutsPanelStore, (state) => state.saving)
  return (
    <DialogFrame
      title="Save layout"
      isOpen={open}
      onOpenChange={(isOpen) => {
        if (!isOpen) closeSaveLayoutPrompt()
      }}
    >
      {open ? (
        <SaveLayoutForm
          library={layouts}
          autoFocus
          onSaved={closeSaveLayoutPrompt}
          onCancel={closeSaveLayoutPrompt}
        />
      ) : null}
    </DialogFrame>
  )
}
