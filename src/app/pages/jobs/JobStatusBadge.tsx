import {
  Ban,
  CircleCheck,
  CircleDashed,
  CircleSlash,
  CircleX,
  LoaderCircle,
  type LucideIcon,
} from 'lucide-react'
import type { TaskStatus } from '../../../domain/types.ts'
import styles from '../../components/components.module.css'
import { cx } from '../../cx.ts'
import { JOB_STATUS_LABELS } from './jobView.ts'

// Job states follow the stage badge: routine states are quiet text with an
// icon, Running uses the info tone, and failures add tone and a tint.
const META: Record<TaskStatus, { icon: LucideIcon; className?: string }> = {
  queued: { icon: CircleDashed, className: styles.stateQuiet },
  running: { icon: LoaderCircle, className: styles.stateRunning },
  succeeded: { icon: CircleCheck, className: styles.stateQuiet },
  failed: {
    icon: CircleX,
    className: cx(styles.stateAttention, styles.danger),
  },
  cancelled: { icon: Ban, className: styles.stateQuiet },
  invalidated: {
    icon: CircleSlash,
    className: cx(styles.stateAttention, styles.warning),
  },
}

export function JobStatusBadge({ status }: { status: TaskStatus }) {
  const meta = META[status]
  const Icon = meta.icon
  return (
    <span className={cx(styles.state, meta.className)}>
      <Icon size={12} aria-hidden="true" />
      {JOB_STATUS_LABELS[status]}
    </span>
  )
}
