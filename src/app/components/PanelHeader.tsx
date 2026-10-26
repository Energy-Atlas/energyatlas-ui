import type { ReactNode } from 'react'
import { cx } from '../cx.ts'
import styles from './primitives.module.css'

type PanelHeaderProps = {
  title: ReactNode
  /** Id of the heading, for the region's aria-labelledby. */
  headingId?: string
  /** 2 for pages and panels, 3 for a pane inside a page. */
  level?: 2 | 3
  /** Badges and counts shown beside the title. */
  meta?: ReactNode
  /** Controls at the end of the header: a toolbar, a filter, or buttons. */
  actions?: ReactNode
  /** One muted line under the title. */
  description?: ReactNode
  className?: string
}

/**
 * The header of every page, panel, and pane (decision 0027): the title with
 * its badges, and controls pushed to the end that wrap under the title when
 * the pane is narrow.
 */
export function PanelHeader({
  title,
  headingId,
  level = 2,
  meta,
  actions,
  description,
  className,
}: PanelHeaderProps) {
  const Heading = level === 2 ? 'h2' : 'h3'
  return (
    <header className={cx(styles.header, className)}>
      <div className={styles.headerTitle}>
        <Heading id={headingId}>{title}</Heading>
        {meta}
      </div>
      {actions ? <div className={styles.headerActions}>{actions}</div> : null}
      {description ? <p className={styles.description}>{description}</p> : null}
    </header>
  )
}

/** A muted count beside a title, such as "12 of 40". */
export function HeaderCount({ children }: { children: ReactNode }) {
  return <span className={styles.count}>{children}</span>
}
