import type { ReactNode } from 'react'
import { useServices } from '../WorkbenchContext.tsx'
import { cx } from '../cx.ts'
import styles from './components.module.css'

type ActionButtonProps = {
  /** Accessible name, including the object acted on. */
  label: string
  children: ReactNode
  /** Why the action cannot run; the button stays focusable and explains itself. */
  disabledReason: string | null
  onPress: () => void
  variant?: 'default' | 'primary'
}

/**
 * Records why an unavailable control could not run, in the operation log
 * shown in the status bar. Toolbar and MenuButton take it as `onBlocked`.
 */
export function useRecordBlocked(): (label: string, reason: string) => void {
  const { workbench } = useServices()
  return (label, reason) =>
    workbench.record({
      type: 'action.blocked',
      title: label,
      status: 'rejected',
      summary: '',
      issues: [{ path: '', message: reason }],
    })
}

/**
 * A button that stays focusable when unavailable. Pressing it records the
 * reason in the operation log (shown in the status bar) instead of silently
 * doing nothing.
 */
export function ActionButton({
  label,
  children,
  disabledReason,
  onPress,
  variant = 'default',
}: ActionButtonProps) {
  const recordBlocked = useRecordBlocked()
  return (
    <button
      type="button"
      className={cx(styles.button, variant === 'primary' && styles.primary)}
      aria-label={label}
      aria-disabled={disabledReason ? true : undefined}
      title={disabledReason ?? label}
      onClick={() => {
        if (disabledReason) {
          recordBlocked(label, disabledReason)
          return
        }
        onPress()
      }}
    >
      {children}
    </button>
  )
}
