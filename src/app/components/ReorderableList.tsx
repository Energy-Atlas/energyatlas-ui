import { GripVertical } from 'lucide-react'
import type { ReactNode } from 'react'
import {
  Button,
  Checkbox,
  DropIndicator,
  GridList,
  GridListItem,
  Text,
  useDragAndDrop,
  type Key,
} from 'react-aria-components'
import { cx } from '../cx.ts'
import formStyles from './forms.module.css'
import styles from './reorderableList.module.css'

export type ReorderableItem = {
  id: string
  /** The row's name; type-ahead matches it. */
  title: string
  /** One muted line under the title. */
  meta?: string
  /** The row's own switch, such as whether a map layer is shown. */
  checked: boolean
}

type ReorderableListProps = {
  'aria-label': string
  items: ReorderableItem[]
  selectedId: string | null
  onSelect: (id: string) => void
  /** Names the row's switch for assistive technology, e.g. "Show Buildings". */
  checkLabel: (item: ReorderableItem) => string
  onCheck: (id: string, checked: boolean) => void
  /** Moves a row to a position counted from the top. */
  onMove: (id: string, position: number) => void
  /** Shown instead of the list when there are no items. */
  empty?: ReactNode
  className?: string
}

/**
 * An ordered list whose rows are chosen, switched, and reordered (decision
 * 0031): the map's layer stack. Each row has a drag handle, a checkbox, a
 * title, and a muted meta line; the chosen row is a fill. Rows move by
 * dragging the handle, or from the keyboard by focusing the handle and pressing
 * Enter, then arrows and Enter to drop. Callers also offer Move up and Move
 * down buttons, which are easier to find.
 */
export function ReorderableList({
  'aria-label': ariaLabel,
  items,
  selectedId,
  onSelect,
  checkLabel,
  onCheck,
  onMove,
  empty,
  className,
}: ReorderableListProps) {
  const { dragAndDropHooks } = useDragAndDrop({
    getItems: (keys) => [...keys].map((key) => ({ 'text/plain': String(key) })),
    onReorder(event) {
      const [moved] = [...event.keys]
      const from = items.findIndex((item) => item.id === moved)
      const target = items.findIndex((item) => item.id === event.target.key)
      if (from < 0 || target < 0) return
      // The drop lands before or after the target row; once the moved row is
      // taken out, rows below it shift up by one.
      let position = event.target.dropPosition === 'after' ? target + 1 : target
      if (from < position) position -= 1
      if (position !== from) onMove(String(moved), position)
    },
    renderDropIndicator: (target) => (
      <DropIndicator target={target} className={styles.dropIndicator} />
    ),
  })

  if (items.length === 0 && empty) return <>{empty}</>

  return (
    <GridList
      aria-label={ariaLabel}
      className={cx(styles.list, className)}
      items={items}
      selectionMode="single"
      selectionBehavior="replace"
      disallowEmptySelection
      selectedKeys={selectedId ? [selectedId] : []}
      onSelectionChange={(keys) => {
        if (keys === 'all') return
        const [key] = [...keys] as Key[]
        if (key !== undefined && key !== selectedId) onSelect(String(key))
      }}
      dragAndDropHooks={dragAndDropHooks}
    >
      {(item) => (
        <GridListItem
          id={item.id}
          textValue={item.title}
          className={styles.row}
        >
          <Button
            slot="drag"
            className={styles.handle}
            aria-label={`Move ${item.title}`}
          >
            <GripVertical size={14} aria-hidden="true" />
          </Button>
          <Checkbox
            className={formStyles.checkbox}
            aria-label={checkLabel(item)}
            isSelected={item.checked}
            onChange={(checked) => onCheck(item.id, checked)}
          />
          <div className={styles.text}>
            <span className={styles.title}>{item.title}</span>
            {item.meta ? (
              <Text slot="description" className={styles.meta}>
                {item.meta}
              </Text>
            ) : null}
          </div>
        </GridListItem>
      )}
    </GridList>
  )
}
