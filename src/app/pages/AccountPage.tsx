import { useId } from 'react'
import { AccountAvatar } from '../components/AccountAvatar.tsx'
import { CapabilityBadge } from '../components/CapabilityBadge.tsx'
import styles from '../components/components.module.css'
import { DEMO_ACCOUNT } from '../demoAccount.ts'
import pageStyles from './pages.module.css'

/** The demo account, opened from the ribbon's initials or View > Panels. */
export function AccountPage() {
  const headingId = useId()
  return (
    <section className={styles.page} aria-labelledby={headingId}>
      <h2 id={headingId}>Account</h2>
      <div className={pageStyles.account}>
        <AccountAvatar size="large" />
        <dl className={pageStyles.accountFacts}>
          <dt>Name</dt>
          <dd>
            {DEMO_ACCOUNT.name} <CapabilityBadge id="account.demo" />
          </dd>
          <dt>Role</dt>
          <dd>{DEMO_ACCOUNT.role}</dd>
        </dl>
      </div>
    </section>
  )
}
