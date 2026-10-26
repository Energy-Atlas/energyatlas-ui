import { Ellipsis, type LucideIcon } from 'lucide-react'
import { useLayoutEffect, useRef, useState } from 'react'
import { Separator, Toolbar as AriaToolbar } from 'react-aria-components'
import { cx } from '../cx.ts'
import componentStyles from './components.module.css'
import { MenuButton } from './MenuButton.tsx'
import styles from './primitives.module.css'
import { overflowingItems } from './toolbarFit.ts'

export type ToolbarItem = {
  id: string
  /** Visible text, and the accessible name unless `ariaLabel` is given. */
  label: string
  /** A fuller accessible name, such as one naming the object acted on. */
  ariaLabel?: string
  icon?: LucideIcon
  /** Shows only the icon; the label stays the name and the tooltip. */
  iconOnly?: boolean
  onPress: () => void
  /** Why the action cannot run now; the button stays focusable and says so. */
  disabledReason?: string | null
  /** Primary actions are the inverted block and never move into More. */
  primary?: boolean
  /** For toggles: whether the option is on. */
  pressed?: boolean
  /** Items with different groups are separated by a rule. */
  group?: string
}

type ToolbarProps = {
  'aria-label': string
  items: ToolbarItem[]
  /** Called instead of onPress when an unavailable item is pressed. */
  onBlocked?: (item: ToolbarItem, reason: string) => void
  className?: string
}

/** Measured once per set of items; the More button's width is measured too. */
type Widths = { key: string; items: number[]; more: number; gap: number }

function itemKey(items: ToolbarItem[]): string {
  return items
    .map((item) => `${item.id}:${item.label}:${item.iconOnly ? 1 : 0}`)
    .join('|')
}

/**
 * A row of actions (decision 0027). Arrow keys move between them, primary
 * actions use the inverted block, and items that do not fit the pane move
 * into a More menu from the end instead of wrapping.
 */
export function Toolbar({
  'aria-label': ariaLabel,
  items,
  onBlocked,
  className,
}: ToolbarProps) {
  const frameRef = useRef<HTMLDivElement>(null)
  const measureRef = useRef<HTMLDivElement>(null)
  const [widths, setWidths] = useState<Widths | null>(null)
  const [available, setAvailable] = useState<number | null>(null)
  const key = itemKey(items)

  // Measure every item, laid out once in an inert copy.
  useLayoutEffect(() => {
    const measure = measureRef.current
    if (!measure) return
    const children = [...measure.children] as HTMLElement[]
    const more = children.pop()
    const gap = Number.parseFloat(getComputedStyle(measure).columnGap) || 0
    setWidths({
      key,
      items: children.map((child) => child.getBoundingClientRect().width),
      more: more?.getBoundingClientRect().width ?? 0,
      gap,
    })
  }, [key])

  // Follow the space the frame is given.
  useLayoutEffect(() => {
    const frame = frameRef.current
    if (!frame || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setAvailable(entry.contentRect.width)
    })
    observer.observe(frame)
    return () => observer.disconnect()
  }, [])

  const overflow =
    widths && widths.key === key && available !== null && available > 0
      ? overflowingItems({
          widths: widths.items,
          pinned: items.map((item) => Boolean(item.primary)),
          gap: widths.gap,
          available,
          moreWidth: widths.more,
        })
      : new Set<number>()
  // The frame asks for the full row and is capped by its container, so the
  // space it reports never depends on which items it currently shows.
  const fullWidth =
    widths && widths.key === key
      ? widths.items.reduce((sum, width) => sum + width, 0) +
        widths.gap * Math.max(0, widths.items.length - 1)
      : undefined
  const shown = items.filter((_, index) => !overflow.has(index))
  const hidden = items.filter((_, index) => overflow.has(index))

  const press = (item: ToolbarItem) => {
    if (item.disabledReason) {
      onBlocked?.(item, item.disabledReason)
      return
    }
    item.onPress()
  }

  return (
    <div
      ref={frameRef}
      className={cx(styles.toolbarFrame, className)}
      style={fullWidth === undefined ? undefined : { width: fullWidth + 1 }}
    >
      <AriaToolbar aria-label={ariaLabel} className={styles.toolbar}>
        {shown.map((item, index) => (
          <ToolbarEntry
            key={item.id}
            item={item}
            separated={index > 0 && shown[index - 1]?.group !== item.group}
            onPress={() => press(item)}
          />
        ))}
        {hidden.length > 0 ? (
          <MenuButton
            aria-label={`More actions: ${ariaLabel}`}
            label={<Ellipsis size={14} aria-hidden="true" />}
            placement="bottom end"
            groups={[
              {
                id: 'more',
                items: hidden.map((item) => ({
                  id: item.id,
                  label: item.pressed ? `${item.label} (on)` : item.label,
                  disabledReason: item.disabledReason ?? null,
                })),
              },
            ]}
            onAction={(id) => {
              const item = hidden.find((candidate) => candidate.id === id)
              if (item) press(item)
            }}
            onBlocked={(entry, reason) => {
              const item = hidden.find((candidate) => candidate.id === entry.id)
              if (item) onBlocked?.(item, reason)
            }}
          />
        ) : null}
      </AriaToolbar>
      <div ref={measureRef} className={styles.measure} aria-hidden="true" inert>
        {items.map((item, index) => (
          <ToolbarEntry
            key={item.id}
            item={item}
            separated={index > 0 && items[index - 1]?.group !== item.group}
            onPress={() => undefined}
            measuring
          />
        ))}
        <span className={cx(componentStyles.button)}>
          <Ellipsis size={14} aria-hidden="true" />
        </span>
      </div>
    </div>
  )
}

function ToolbarEntry({
  item,
  separated,
  onPress,
  measuring = false,
}: {
  item: ToolbarItem
  separated: boolean
  onPress: () => void
  measuring?: boolean
}) {
  const Icon = item.icon
  return (
    <span className={styles.toolItem}>
      {separated ? (
        measuring ? (
          <span className={styles.toolbarSeparator} />
        ) : (
          <Separator
            orientation="vertical"
            className={styles.toolbarSeparator}
          />
        )
      ) : null}
      <button
        type="button"
        tabIndex={measuring ? -1 : undefined}
        className={cx(
          componentStyles.button,
          styles.toolButton,
          item.primary && componentStyles.primary,
        )}
        aria-label={
          item.iconOnly ? (item.ariaLabel ?? item.label) : item.ariaLabel
        }
        aria-pressed={item.pressed}
        aria-disabled={item.disabledReason ? true : undefined}
        title={item.disabledReason ?? item.ariaLabel ?? item.label}
        onClick={onPress}
      >
        {Icon ? <Icon size={14} aria-hidden="true" /> : null}
        {item.iconOnly && Icon ? null : item.label}
      </button>
    </span>
  )
}
