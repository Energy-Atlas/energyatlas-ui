import { X } from 'lucide-react'
import type { ReactNode } from 'react'
import {
  Button,
  Dialog,
  Heading,
  Keyboard,
  Modal,
  ModalOverlay,
} from 'react-aria-components'
import type { AppAction } from '../actions.ts'
import { CapabilityTable } from '../components/CapabilityTable.tsx'
import componentStyles from '../components/components.module.css'
import menuStyles from '../components/menus.module.css'
import { cx } from '../cx.ts'
import styles from './shell.module.css'

type DialogFrameProps = {
  title: string
  isOpen: boolean
  onOpenChange: (isOpen: boolean) => void
  children: ReactNode
  role?: 'dialog' | 'alertdialog'
  isBusy?: boolean
}

export function DialogFrame({
  title,
  isOpen,
  onOpenChange,
  children,
  role = 'dialog',
  isBusy = false,
}: DialogFrameProps) {
  return (
    <ModalOverlay
      isOpen={isOpen}
      onOpenChange={onOpenChange}
      isDismissable={role === 'dialog' && !isBusy}
      isKeyboardDismissDisabled={isBusy}
      className={styles.overlay}
    >
      <Modal className={styles.dialogModal}>
        <Dialog role={role} className={styles.dialog}>
          <div className={styles.dialogHeader}>
            <Heading slot="title" className={styles.dialogTitle}>
              {title}
            </Heading>
            <Button
              slot="close"
              className={styles.iconButton}
              aria-label="Close"
              isDisabled={isBusy}
            >
              <X size={16} aria-hidden="true" />
            </Button>
          </div>
          <div className={styles.dialogBody}>{children}</div>
        </Dialog>
      </Modal>
    </ModalOverlay>
  )
}

// Fixed keys provided by FlexLayout's ARIA widgets and our keyMap.
const LAYOUT_KEYS: [string, string][] = [
  ['Arrow keys (on a tab)', 'Move between tabs in a tab group'],
  ['Enter (on a selected tab)', 'Move focus into the tab content'],
  ['F6 / Shift+F6', 'Move focus to the next or previous tab group'],
  ['Arrow keys (on a splitter)', 'Resize panels'],
  ['Ctrl+Delete (on a tab)', 'Close the tab when it can be closed'],
  [
    'Command palette (Ctrl+K)',
    'Split the active tab or move it to the next tab group',
  ],
]

export function ShortcutsDialog({
  isOpen,
  onOpenChange,
  actions,
}: {
  isOpen: boolean
  onOpenChange: (isOpen: boolean) => void
  actions: AppAction[]
}) {
  const withShortcuts = actions.filter((action) => action.shortcut)
  return (
    <DialogFrame
      title="Keyboard shortcuts"
      isOpen={isOpen}
      onOpenChange={onOpenChange}
    >
      <table className={componentStyles.table}>
        <caption>Commands</caption>
        <thead>
          <tr>
            <th scope="col">Shortcut</th>
            <th scope="col">Command</th>
          </tr>
        </thead>
        <tbody>
          {withShortcuts.map((action) => (
            <tr key={action.id}>
              <td>
                <Keyboard className={menuStyles.kbd}>
                  {[action.shortcut, ...(action.alternateShortcuts ?? [])].join(
                    ' or ',
                  )}
                </Keyboard>
              </td>
              <td>{action.label}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <table className={componentStyles.table}>
        <caption>Layout</caption>
        <thead>
          <tr>
            <th scope="col">Keys</th>
            <th scope="col">Effect</th>
          </tr>
        </thead>
        <tbody>
          {LAYOUT_KEYS.map(([keys, effect]) => (
            <tr key={keys}>
              <td>
                <Keyboard className={menuStyles.kbd}>{keys}</Keyboard>
              </td>
              <td>{effect}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </DialogFrame>
  )
}

export function CapabilitiesDialog({
  isOpen,
  onOpenChange,
}: {
  isOpen: boolean
  onOpenChange: (isOpen: boolean) => void
}) {
  return (
    <DialogFrame
      title="What is working, simulated, or planned"
      isOpen={isOpen}
      onOpenChange={onOpenChange}
    >
      <p className={componentStyles.muted}>
        All data in this prototype is synthetic. Simulated features use
        deterministic stand-ins; planned features are visible but not available.
      </p>
      <CapabilityTable />
    </DialogFrame>
  )
}

export function NewProjectDialog({
  isOpen,
  onOpenChange,
  onConfirm,
}: {
  isOpen: boolean
  onOpenChange: (isOpen: boolean) => void
  onConfirm: () => void
}) {
  return (
    <DialogFrame
      title="Start a new empty project?"
      role="alertdialog"
      isOpen={isOpen}
      onOpenChange={onOpenChange}
    >
      <p>
        The current project in the workbench is replaced by an empty synthetic
        project, and undo history is cleared. The copy saved in this browser
        stays until you save again.
      </p>
      <div className={styles.dialogActions}>
        <Button slot="close" className={componentStyles.button}>
          Cancel
        </Button>
        <Button
          className={cx(componentStyles.button, componentStyles.primary)}
          onPress={() => {
            onConfirm()
            onOpenChange(false)
          }}
        >
          Start new project
        </Button>
      </div>
    </DialogFrame>
  )
}
