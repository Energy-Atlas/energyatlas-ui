import { ChevronRight } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import {
  Button,
  Disclosure,
  DisclosurePanel,
  Heading,
} from 'react-aria-components'
import { cx } from '../cx.ts'
import styles from './primitives.module.css'

// Open sections stay open while the app runs, so a page that remounts (a
// project switch, a redocked tab) shows them as the reader left them.
const remembered = new Map<string, boolean>()

type SectionProps = {
  /** The trigger's text; name what opening it shows. */
  title: ReactNode
  /** Remembers the open state under this id for the rest of the session. */
  id?: string
  /** A count shown after the title, such as the number of rows. */
  count?: number
  defaultExpanded?: boolean
  /** Heading level of the trigger: 3 inside a page, 4 inside a pane. */
  level?: 3 | 4
  children: ReactNode
  className?: string
}

/**
 * A ruled disclosure (decision 0027) for content read on demand: chart data
 * tables, item lists, and details.
 */
export function Section({
  title,
  id,
  count,
  defaultExpanded = false,
  level = 3,
  children,
  className,
}: SectionProps) {
  const [expanded, setExpanded] = useState(
    () => (id ? remembered.get(id) : undefined) ?? defaultExpanded,
  )
  return (
    <Disclosure
      className={cx(styles.section, className)}
      isExpanded={expanded}
      onExpandedChange={(next) => {
        setExpanded(next)
        if (id) remembered.set(id, next)
      }}
    >
      <Heading level={level} className={styles.sectionHeading}>
        <Button slot="trigger" className={styles.sectionTrigger}>
          <ChevronRight size={14} aria-hidden="true" />
          {title}
          {count === undefined ? null : (
            <span className={styles.count}>
              ({count.toLocaleString('en-US')})
            </span>
          )}
        </Button>
      </Heading>
      <DisclosurePanel className={styles.sectionPanel}>
        {children}
      </DisclosurePanel>
    </Disclosure>
  )
}
