import {
  CircleCheck,
  CircleX,
  Info,
  TriangleAlert,
  type LucideIcon,
} from 'lucide-react'
import type { ReactNode } from 'react'
import { cx } from '../cx.ts'
import styles from './primitives.module.css'

export type Tone = 'info' | 'success' | 'warning' | 'danger'

export const TONE_META: Record<
  Tone,
  { icon: LucideIcon; label: string; className: string | undefined }
> = {
  info: { icon: Info, label: 'Note', className: styles.toneInfo },
  success: { icon: CircleCheck, label: 'Done', className: styles.toneSuccess },
  warning: {
    icon: TriangleAlert,
    label: 'Warning',
    className: styles.toneWarning,
  },
  danger: { icon: CircleX, label: 'Error', className: styles.toneDanger },
}

type InlineAlertProps = {
  tone: Tone
  title?: ReactNode
  children?: ReactNode
  /** Buttons that resolve the alert, shown at its end. */
  actions?: ReactNode
  /**
   * How a change is announced. Errors interrupt (alert); "polite" suits
   * results that appear after an action; "off" suits notices present from the
   * start. Errors default to "assertive", everything else to "off".
   */
  live?: 'assertive' | 'polite' | 'off'
  className?: string
}

/**
 * A state shown where it applies (decision 0027): page notices, stale
 * results, blocking issues, and the result of a form. Events that happened
 * elsewhere belong to messages instead.
 */
export function InlineAlert({
  tone,
  title,
  children,
  actions,
  live = tone === 'danger' ? 'assertive' : 'off',
  className,
}: InlineAlertProps) {
  const meta = TONE_META[tone]
  const Icon = meta.icon
  const role =
    live === 'assertive' ? 'alert' : live === 'polite' ? 'status' : undefined
  return (
    <div
      role={role}
      className={cx(styles.alert, meta.className, className)}
      data-tone={tone}
    >
      <Icon size={14} aria-label={meta.label} role="img" />
      <div className={styles.alertBody}>
        {title ? <p className={styles.alertTitle}>{title}</p> : null}
        {typeof children === 'string' ? <p>{children}</p> : children}
      </div>
      {actions ? <div className={styles.alertActions}>{actions}</div> : null}
    </div>
  )
}
