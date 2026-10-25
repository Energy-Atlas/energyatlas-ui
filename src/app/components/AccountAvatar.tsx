import { cx } from '../cx.ts'
import { accountInitials, DEMO_ACCOUNT } from '../demoAccount.ts'
import styles from './components.module.css'

/** The demo account's initials in a circle; decorative, so callers name it. */
export function AccountAvatar({
  size = 'small',
  title,
}: {
  size?: 'small' | 'large'
  title?: string
}) {
  return (
    <span
      className={cx(styles.avatar, size === 'large' && styles.avatarLarge)}
      aria-hidden="true"
      title={title}
    >
      {accountInitials(DEMO_ACCOUNT.name)}
    </span>
  )
}
