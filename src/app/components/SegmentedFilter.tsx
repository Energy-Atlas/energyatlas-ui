import { useId } from 'react'
import type { Key } from 'react-aria-components'
import { ToggleButton, ToggleButtonGroup } from 'react-aria-components'
import { cx } from '../cx.ts'
import styles from './primitives.module.css'

export type Segment<T extends string> = {
  id: T
  label: string
  /** Items the choice would show; part of the accessible name. */
  count?: number
  /** Why the choice is unavailable now. */
  disabledReason?: string | null
}

type SegmentedFilterProps<T extends string> = {
  /** Names the choice for assistive technology, such as "Show jobs". */
  'aria-label': string
  segments: Segment<T>[]
  value: T
  onChange: (value: T) => void
  className?: string
}

/**
 * One choice among a few views of the same content (decision 0027), such as
 * "All / Active / Needs attention". It reads as a radio group; arrow keys move
 * between choices and Space or Enter picks one.
 */
export function SegmentedFilter<T extends string>({
  'aria-label': ariaLabel,
  segments,
  value,
  onChange,
  className,
}: SegmentedFilterProps<T>) {
  const reasonId = useId()
  const byId = new Map<Key, T>(
    segments.map((segment) => [segment.id, segment.id]),
  )
  return (
    <ToggleButtonGroup
      aria-label={ariaLabel}
      className={cx(styles.segmented, className)}
      selectionMode="single"
      disallowEmptySelection
      selectedKeys={[value]}
      onSelectionChange={(keys) => {
        const [first] = [...keys]
        const next = first === undefined ? undefined : byId.get(first)
        if (next !== undefined && next !== value) onChange(next)
      }}
    >
      {segments.map((segment) => (
        <ToggleButton
          key={segment.id}
          id={segment.id}
          className={styles.segment}
          isDisabled={Boolean(segment.disabledReason)}
          aria-describedby={
            segment.disabledReason ? `${reasonId}-${segment.id}` : undefined
          }
          aria-label={
            segment.count === undefined
              ? undefined
              : `${segment.label}, ${segment.count.toLocaleString('en-US')}`
          }
        >
          <span title={segment.disabledReason ?? undefined}>
            {segment.label}
          </span>
          {segment.count === undefined ? null : (
            <span className={styles.segmentCount} aria-hidden="true">
              {segment.count.toLocaleString('en-US')}
            </span>
          )}
        </ToggleButton>
      ))}
      {segments.map((segment) =>
        segment.disabledReason ? (
          <span
            key={segment.id}
            id={`${reasonId}-${segment.id}`}
            className="visually-hidden"
          >
            {segment.disabledReason}
          </span>
        ) : null,
      )}
    </ToggleButtonGroup>
  )
}
