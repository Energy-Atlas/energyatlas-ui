import { useEffect, useRef } from 'react'
import {
  Autocomplete,
  Dialog,
  Input,
  Keyboard,
  Menu,
  MenuItem,
  Modal,
  ModalOverlay,
  SearchField,
  Text,
  useFilter,
} from 'react-aria-components'
import type { AppAction } from '../actions.ts'
import styles from './shell.module.css'

type CommandPaletteProps = {
  isOpen: boolean
  onOpenChange: (isOpen: boolean) => void
  actions: AppAction[]
  invoke: (action: AppAction) => void
}

export function CommandPalette({
  isOpen,
  onOpenChange,
  actions,
  invoke,
}: CommandPaletteProps) {
  const { contains } = useFilter({ sensitivity: 'base' })
  const menuRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  // Opened from a focused workbench control, the field's autofocus does not
  // take, and the browser later drops focus to the body when the workbench
  // becomes inert. Move focus into the field once the modal has mounted.
  useEffect(() => {
    if (!isOpen) return
    const frame = window.requestAnimationFrame(() => {
      const input = inputRef.current
      const dialog = input?.closest('[role="dialog"]')
      if (input && !dialog?.contains(document.activeElement)) input.focus()
    })
    return () => window.cancelAnimationFrame(frame)
  }, [isOpen])

  // React Aria's Autocomplete replays the field's keys on the focused menu
  // item. The item cancels Backspace, and Autocomplete then cancels the real
  // key, so the field never edits (Delete is unaffected). Stop the replayed
  // Backspace at the menu so the field deletes normally.
  useEffect(() => {
    const menu = menuRef.current
    if (!menu || !isOpen) return
    const stopReplayedBackspace = (event: KeyboardEvent) => {
      if (event.key === 'Backspace' && !event.isTrusted) {
        event.stopImmediatePropagation()
      }
    }
    menu.addEventListener('keydown', stopReplayedBackspace, true)
    return () => {
      menu.removeEventListener('keydown', stopReplayedBackspace, true)
    }
  }, [isOpen])

  return (
    <ModalOverlay
      isOpen={isOpen}
      onOpenChange={onOpenChange}
      isDismissable
      className={styles.overlay}
    >
      <Modal className={styles.paletteModal}>
        <Dialog aria-label="Command palette" className={styles.dialog}>
          <Autocomplete filter={contains}>
            <SearchField
              aria-label="Search commands"
              autoFocus
              className={styles.paletteSearch}
            >
              <Input
                ref={inputRef}
                placeholder="Type a command"
                className={styles.paletteInput}
              />
            </SearchField>
            <Menu
              ref={menuRef}
              items={actions}
              className={styles.paletteMenu}
              disabledKeys={actions
                .filter((action) => action.disabledReason)
                .map((action) => action.id)}
              renderEmptyState={() => (
                <p className={styles.paletteEmpty}>No matching commands.</p>
              )}
              onAction={(key) => {
                const action = actions.find((candidate) => candidate.id === key)
                onOpenChange(false)
                if (action) invoke(action)
              }}
            >
              {(action) => (
                <MenuItem
                  id={action.id}
                  textValue={`${action.group} ${action.label}`}
                  className={styles.menuItem}
                >
                  <span className={styles.menuCheck} aria-hidden="true" />
                  <Text slot="label" className={styles.menuLabel}>
                    {action.label}
                    <span className={styles.paletteGroup}>
                      {' '}
                      · {action.group}
                    </span>
                  </Text>
                  {action.disabledReason ? (
                    <Text slot="description" className={styles.menuDescription}>
                      {action.disabledReason}
                    </Text>
                  ) : null}
                  {action.shortcut ? (
                    <Keyboard className={styles.kbd}>
                      {action.shortcut}
                    </Keyboard>
                  ) : null}
                </MenuItem>
              )}
            </Menu>
          </Autocomplete>
        </Dialog>
      </Modal>
    </ModalOverlay>
  )
}
