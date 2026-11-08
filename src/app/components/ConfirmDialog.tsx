import { X } from 'lucide-react'
import { useRef, useState, type ReactNode } from 'react'
import {
  Button,
  Dialog,
  Heading,
  Modal,
  ModalOverlay,
} from 'react-aria-components'
import { cx } from '../cx.ts'
import shellStyles from '../shell/shell.module.css'
import componentStyles from './components.module.css'
import { InlineAlert } from './InlineAlert.tsx'
import styles from './primitives.module.css'

/**
 * What a confirming press returns: nothing (or null) when it is done and the
 * dialog closes, or a message saying why it failed, which the dialog shows
 * while it stays open.
 */
export type ConfirmResult = void | null | string

export type ConfirmChoice = {
  label: string
  /** Accessible name when the label alone does not name the object. */
  ariaLabel?: string
  /** Why the choice cannot be made now; the button stays focusable. */
  disabledReason?: string | null
  onPress: () => ConfirmResult | Promise<ConfirmResult>
}

type ConfirmDialogProps = {
  isOpen: boolean
  /** Closes the dialog: Cancel, Esc, the close button, or a finished choice. */
  onOpenChange: (isOpen: boolean) => void
  /** The question, such as `Delete "Review"?`. */
  title: string
  /** What happens and what does not. */
  children?: ReactNode
  /** The confirming choice; Enter presses it. */
  confirm: ConfirmChoice
  /** A second way to go on, between Cancel and the confirming choice. */
  secondary?: ConfirmChoice
  cancelLabel?: string
  /** Waiting for something outside the dialog, such as the server. */
  isBusy?: boolean
  /** Shown while busy; defaults to "Waiting…". */
  busyText?: string
  /** An error from outside the dialog, shown with its own. */
  error?: string | null
  /** More content under the text, such as a control for the busy state. */
  extra?: ReactNode
  /**
   * Where focus goes when the control that opened the dialog is gone once
   * it closes, such as the actions of a deleted row.
   */
  returnFocus?: () => HTMLElement | null
  /** Reports an unavailable choice that was pressed, as other controls do. */
  onBlocked?: (label: string, reason: string) => void
}

/** About a second at 60 frames a second; a dialog still mounted after that is left alone. */
const MAX_CLOSE_FRAMES = 60

function isOtherControl(target: EventTarget | null, confirm: Element | null) {
  if (!(target instanceof Element) || target === confirm) return false
  return Boolean(
    target.closest('button, a[href], input, textarea, select, [role="button"]'),
  )
}

/**
 * The one confirmation in the app (decision 0036): a modal dialog that asks
 * before something cannot be undone or leaves work behind. Enter presses the
 * confirming button, which has focus when the dialog opens; Esc and Cancel
 * cancel. Focus returns to the control that opened it, or to `returnFocus`
 * when that control is gone. No confirmation is shown inline.
 */
export function ConfirmDialog({
  isOpen,
  onOpenChange,
  title,
  children,
  confirm,
  secondary,
  cancelLabel = 'Cancel',
  isBusy = false,
  busyText = 'Waiting…',
  error = null,
  extra,
  returnFocus,
  onBlocked,
}: ConfirmDialogProps) {
  const [running, setRunning] = useState<string | null>(null)
  const [failure, setFailure] = useState<string | null>(null)
  const confirmRef = useRef<HTMLButtonElement>(null)
  const dialogRef = useRef<HTMLElement>(null)
  const busy = isBusy || running !== null

  // A fresh question each time it opens.
  const [wasOpen, setWasOpen] = useState(isOpen)
  if (wasOpen !== isOpen) {
    setWasOpen(isOpen)
    if (isOpen) {
      setFailure(null)
      setRunning(null)
    }
  }

  const close = () => {
    onOpenChange(false)
    // React Aria returns focus to the opener once the dialog has unmounted.
    // When the opener is gone by then, such as a menu item or a deleted
    // row's menu, focus would drop to the page, so it goes where the caller
    // says instead. The dialog and the opener can take several frames to
    // leave on a slow machine, so this waits for the dialog to unmount, then
    // one more frame for React Aria's own restore, before deciding.
    if (!returnFocus) return
    let frames = 0
    const settle = () => {
      if (dialogRef.current?.isConnected && frames < MAX_CLOSE_FRAMES) {
        frames += 1
        window.requestAnimationFrame(settle)
        return
      }
      window.requestAnimationFrame(() => {
        const active = document.activeElement
        if (!active || active === document.body || !active.isConnected) {
          returnFocus()?.focus()
        }
      })
    }
    window.requestAnimationFrame(settle)
  }

  const choose = async (choice: ConfirmChoice) => {
    if (busy) return
    if (choice.disabledReason) {
      onBlocked?.(choice.ariaLabel ?? choice.label, choice.disabledReason)
      return
    }
    setFailure(null)
    setRunning(choice.label)
    let result: ConfirmResult
    try {
      result = await choice.onPress()
    } catch (caught) {
      result = caught instanceof Error ? caught.message : String(caught)
    }
    setRunning(null)
    if (typeof result === 'string' && result) setFailure(result)
    else close()
  }

  const choiceButton = (choice: ConfirmChoice, primary: boolean) => (
    <Button
      ref={primary ? confirmRef : undefined}
      className={cx(componentStyles.button, primary && componentStyles.primary)}
      aria-label={choice.ariaLabel}
      aria-disabled={choice.disabledReason || busy ? true : undefined}
      // The confirming choice takes focus, so Enter confirms (decision 0036).
      autoFocus={primary}
      onPress={() => void choose(choice)}
    >
      {running === choice.label ? busyText : choice.label}
    </Button>
  )

  const shownError = failure ?? error
  const reasons = [confirm, secondary]
    .map((choice) => choice?.disabledReason)
    .filter((reason): reason is string => Boolean(reason))

  return (
    <ModalOverlay
      isOpen={isOpen}
      onOpenChange={(open) => {
        if (!open && !busy) close()
      }}
      isDismissable={false}
      isKeyboardDismissDisabled={busy}
      className={shellStyles.overlay}
    >
      <Modal className={cx(shellStyles.dialogModal, styles.confirmModal)}>
        <Dialog
          ref={dialogRef}
          role="alertdialog"
          className={shellStyles.dialog}
        >
          {/* Enter anywhere but on another button presses the confirming one. */}
          <div
            onKeyDown={(event) => {
              if (event.key !== 'Enter' || event.nativeEvent.isComposing) return
              if (isOtherControl(event.target, confirmRef.current)) return
              event.preventDefault()
              void choose(confirm)
            }}
          >
            <div className={shellStyles.dialogHeader}>
              <Heading slot="title" className={shellStyles.dialogTitle}>
                {title}
              </Heading>
              <Button
                className={shellStyles.iconButton}
                aria-label="Close"
                aria-disabled={busy || undefined}
                excludeFromTabOrder
                onPress={() => {
                  if (!busy) close()
                }}
              >
                <X size={16} aria-hidden="true" />
              </Button>
            </div>
            <div className={shellStyles.dialogBody}>
              {children}
              {extra}
              {reasons.map((reason) => (
                <InlineAlert key={reason} tone="info">
                  {reason}
                </InlineAlert>
              ))}
              {shownError ? (
                <InlineAlert tone="danger">{shownError}</InlineAlert>
              ) : null}
              {busy && running === null ? (
                <p role="status" className={styles.confirmBusy}>
                  {busyText}
                </p>
              ) : null}
              <div className={shellStyles.dialogActions}>
                <Button
                  className={componentStyles.button}
                  aria-disabled={busy || undefined}
                  onPress={() => {
                    if (!busy) close()
                  }}
                >
                  {cancelLabel}
                </Button>
                {secondary ? choiceButton(secondary, false) : null}
                {choiceButton(confirm, true)}
              </div>
            </div>
          </div>
        </Dialog>
      </Modal>
    </ModalOverlay>
  )
}
