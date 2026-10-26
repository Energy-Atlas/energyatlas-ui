import type { ReactNode } from 'react'
import { cx } from '../cx.ts'
import styles from './primitives.module.css'

export type Property = {
  label: ReactNode
  value: ReactNode
  /** Stable key when the label is not a string. */
  key?: string
  /** Identifiers and codes read in the mono face. */
  mono?: boolean
}

type PropertyListProps = {
  /** Falsy entries are skipped, so optional rows can be written inline. */
  items: (Property | null | false | undefined)[]
  className?: string
  'aria-label'?: string
}

/**
 * Labels beside values (decision 0027), for Inspection, job details,
 * provenance, and fit details.
 */
export function PropertyList({
  items,
  className,
  'aria-label': ariaLabel,
}: PropertyListProps) {
  const shown = items.filter((item): item is Property => Boolean(item))
  return (
    <dl className={cx(styles.properties, className)} aria-label={ariaLabel}>
      {shown.map((item, index) => (
        <div
          key={
            item.key ??
            (typeof item.label === 'string' ? item.label : String(index))
          }
          className={styles.property}
        >
          <dt>{item.label}</dt>
          <dd className={item.mono ? styles.mono : undefined}>{item.value}</dd>
        </div>
      ))}
    </dl>
  )
}
