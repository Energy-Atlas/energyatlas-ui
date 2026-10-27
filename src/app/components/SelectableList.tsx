import { useId, useState, type ReactNode } from 'react'
import {
  Input,
  ListBox,
  ListBoxItem,
  SearchField,
  Text,
  type Key,
} from 'react-aria-components'
import { cx } from '../cx.ts'
import componentStyles from './components.module.css'
import formStyles from './forms.module.css'
import { ScrollJump } from './ScrollJump.tsx'
import styles from './selectableList.module.css'

export type SelectableItem = {
  id: string
  /** The row's name; type-ahead and the search match it. */
  title: string
  /** A status badge leading the meta line. */
  status?: ReactNode
  /** One muted line under the title. */
  meta?: ReactNode
  /** Words the meta line shows as markup, for assistive technology and the search. */
  description?: string
}

type SelectableListProps = {
  'aria-label': string
  items: SelectableItem[]
  /**
   * "single" keeps one row selected, which a detail pane follows; "none"
   * makes each row an action, such as opening a project.
   */
  selectionMode?: 'single' | 'none'
  selectedId?: string | null
  onSelect?: (id: string) => void
  onAction?: (id: string) => void
  /** Why the rows cannot be chosen now; the list stays readable. */
  disabledReason?: string | null
  /** Shown instead of the list when there are no items at all. */
  empty?: ReactNode
  /** Adds a field above the list that narrows it by title and description. */
  search?: { label: string; placeholder?: string }
  className?: string
}

function matches(item: SelectableItem, query: string): boolean {
  const text = `${item.title} ${item.description ?? ''}`.toLowerCase()
  return text.includes(query.toLowerCase())
}

/**
 * A list of things to pick from (decision 0027): jobs, archetypes,
 * schedules, library measures, projects. One row anatomy (title, then a
 * status badge and one muted meta line), the selected row in the selection
 * tint with the accent edge, arrow keys and type-ahead between rows, and an
 * optional search field. Rows are listbox options, so they hold no buttons;
 * a row's own action (Enter, or a click when nothing is selected) does the
 * work.
 */
export function SelectableList({
  'aria-label': ariaLabel,
  items,
  selectionMode = 'single',
  selectedId = null,
  onSelect,
  onAction,
  disabledReason = null,
  empty,
  search,
  className,
}: SelectableListProps) {
  const reasonId = useId()
  const [query, setQuery] = useState('')
  const shown = query.trim()
    ? items.filter((item) => matches(item, query.trim()))
    : items
  const ids = new Map<Key, string>(items.map((item) => [item.id, item.id]))

  if (items.length === 0 && empty) return <>{empty}</>

  return (
    <div className={cx(styles.frame, className)}>
      {search ? (
        <SearchField
          aria-label={search.label}
          className={styles.search}
          value={query}
          onChange={setQuery}
        >
          <Input
            className={formStyles.input}
            placeholder={search.placeholder ?? 'Search'}
          />
        </SearchField>
      ) : null}
      {disabledReason ? (
        <p id={reasonId} className={styles.reason}>
          {disabledReason}
        </p>
      ) : null}
      {shown.length === 0 ? (
        <p className={componentStyles.empty}>
          Nothing matches &ldquo;{query.trim()}&rdquo;.{' '}
          <button
            type="button"
            className={componentStyles.button}
            onClick={() => setQuery('')}
          >
            Clear search
          </button>
        </p>
      ) : (
        <ListBox
          aria-label={ariaLabel}
          aria-describedby={disabledReason ? reasonId : undefined}
          className={styles.list}
          items={shown}
          selectionMode={selectionMode}
          selectionBehavior="replace"
          disallowEmptySelection={selectionMode === 'single'}
          disabledKeys={disabledReason ? items.map((item) => item.id) : []}
          selectedKeys={selectedId ? [selectedId] : []}
          onSelectionChange={(keys) => {
            if (keys === 'all') return
            const [key] = [...keys]
            const id = key === undefined ? undefined : ids.get(key)
            if (id !== undefined && id !== selectedId) onSelect?.(id)
          }}
          onAction={
            onAction
              ? (key) => {
                  const id = ids.get(key)
                  if (id !== undefined) onAction(id)
                }
              : undefined
          }
        >
          {(item) => (
            <ListBoxItem
              id={item.id}
              className={styles.row}
              textValue={
                item.description
                  ? `${item.title}, ${item.description}`
                  : item.title
              }
            >
              <Text slot="label" className={styles.title}>
                {item.title}
              </Text>
              {item.status || item.meta ? (
                <Text slot="description" className={styles.meta}>
                  {item.status}
                  {item.meta ? (
                    <span className={componentStyles.muted}>{item.meta}</span>
                  ) : null}
                </Text>
              ) : null}
            </ListBoxItem>
          )}
        </ListBox>
      )}
      <ScrollJump label={ariaLabel} scroller={`.${styles.list}`} />
    </div>
  )
}
