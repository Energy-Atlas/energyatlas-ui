import { X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useStore } from 'zustand'
import { useServices, useWorkbenchSnapshot } from '../WorkbenchContext.tsx'
import { InlineAlert } from '../components/InlineAlert.tsx'
import componentStyles from '../components/components.module.css'
import {
  inScope,
  type Message,
  type MessageAction,
} from '../messages/messageCenter.ts'
import {
  actionFocusTarget,
  useRunMessageAction,
} from '../messages/useMessageActions.ts'
import styles from './shell.module.css'

/** Success and information toasts leave after this long on screen. */
export const TOAST_LIFETIME_MS = 6000

/** Whether a toast leaves by itself; warnings and errors stay until dismissed. */
export function expires(message: Message): boolean {
  return message.tone === 'success' || message.tone === 'info'
}

type ToastProps = {
  message: Message
  /** Stops the clock while the pointer or focus is on the toasts. */
  paused?: boolean
  onAction: (action: MessageAction) => void
  onDismiss: () => void
  /** Called when a success or information toast has been shown long enough. */
  onExpire?: () => void
}

/**
 * One toast (decision 0027): an inline alert floating above the status bar,
 * with the message's actions and a dismiss button. It never takes focus.
 */
export function Toast({
  message,
  paused = false,
  onAction,
  onDismiss,
  onExpire,
}: ToastProps) {
  const remaining = useRef(TOAST_LIFETIME_MS)
  useEffect(() => {
    if (!onExpire || !expires(message) || paused) return
    const started = Date.now()
    const timer = window.setTimeout(onExpire, remaining.current)
    return () => {
      window.clearTimeout(timer)
      remaining.current -= Date.now() - started
    }
  }, [message, paused, onExpire])

  return (
    <InlineAlert
      tone={message.tone}
      live="off"
      className={styles.toast}
      actions={
        <>
          {message.actions.map((action) => (
            <button
              key={action.label}
              type="button"
              className={componentStyles.button}
              onClick={() => onAction(action)}
            >
              {action.label}
            </button>
          ))}
          <button
            type="button"
            className={componentStyles.button}
            aria-label={`Dismiss: ${message.text}`}
            data-toast-dismiss=""
            onClick={onDismiss}
          >
            <X size={14} aria-hidden="true" />
          </button>
        </>
      }
    >
      {message.text}
    </InlineAlert>
  )
}

/** Where focus goes after a toast it was in leaves. */
// Looked up after the render, when a page the action opened is on screen.
type Refocus = { target: () => HTMLElement | null } | null

/**
 * The one place popups appear (decision 0027): at most three toasts, bottom
 * right above the status bar, for asynchronous events and failures. Messages
 * that do not come from the operation log, which the status bar already
 * announces, are announced politely here. Focus on a toast that leaves moves
 * to the next toast or back to the workspace.
 */
export function ToastHost() {
  const { messages } = useServices()
  const runAction = useRunMessageAction()
  const projectId = useWorkbenchSnapshot(
    (snapshot) => snapshot.state.project.id,
  )
  const all = useStore(messages.store, (snapshot) => snapshot.messages)
  const toastIds = useStore(messages.store, (snapshot) => snapshot.toasts)
  const [paused, setPaused] = useState(false)
  const hostRef = useRef<HTMLElement>(null)
  const refocus = useRef<Refocus>(null)
  const [departures, setDepartures] = useState(0)

  const byId = new Map(all.map((message) => [message.id, message]))
  const shown = toastIds.flatMap((id) => {
    const message = byId.get(id)
    return message && inScope(message, projectId) ? [message] : []
  })
  const announced = shown.find((message) => message.operationId === null)

  useEffect(() => {
    const where = refocus.current
    if (!where) return
    refocus.current = null
    const next =
      where.target() ??
      hostRef.current?.querySelector<HTMLElement>('[data-toast-dismiss]') ??
      document.querySelector<HTMLElement>('main[aria-label="Workspace"]')
    next?.focus()
  }, [departures])

  const leave = (id: string, target: () => HTMLElement | null = () => null) => {
    const hadFocus = Boolean(
      hostRef.current?.contains(document.activeElement ?? null),
    )
    messages.dismissToast(id)
    // The pointer or focus leaves with the last toast, so the clock runs for
    // the next ones.
    if (shown.length === 1) setPaused(false)
    if (hadFocus) {
      refocus.current = { target }
      setDepartures((count) => count + 1)
    }
  }

  return (
    <>
      <div role="status" className="visually-hidden">
        {announced?.text ?? ''}
      </div>
      {shown.length > 0 ? (
        <section
          ref={hostRef}
          aria-label="Notifications"
          className={styles.toasts}
          data-testid="toasts"
          onPointerEnter={() => setPaused(true)}
          onPointerLeave={() => setPaused(false)}
          onFocus={() => setPaused(true)}
          onBlur={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget)) {
              setPaused(false)
            }
          }}
        >
          {/* Newest nearest the status bar. */}
          {[...shown].reverse().map((message) => (
            <Toast
              key={message.id}
              message={message}
              paused={paused}
              onAction={(action) => {
                runAction(action)
                leave(message.id, () => actionFocusTarget(action))
              }}
              onDismiss={() => leave(message.id)}
              onExpire={() =>
                messages.dismissToast(message.id, { read: false })
              }
            />
          ))}
        </section>
      ) : null}
    </>
  )
}
