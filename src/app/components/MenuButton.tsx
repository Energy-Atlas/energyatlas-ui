import { Check, ChevronDown } from 'lucide-react'
import type { ReactNode } from 'react'
import {
  Button,
  Header,
  Keyboard,
  Menu,
  MenuItem,
  MenuSection,
  MenuTrigger,
  Popover,
  Separator,
  Text,
  type Key,
  type Selection,
} from 'react-aria-components'
import { cx } from '../cx.ts'
import componentStyles from './components.module.css'
import menuStyles from './menus.module.css'
import styles from './primitives.module.css'

export type MenuEntry = {
  id: string
  label: string
  /** A second line; replaced by the reason when the entry is unavailable. */
  description?: string
  /** Why the entry cannot run now. It stays focusable and explains itself. */
  disabledReason?: string | null
  shortcut?: string
}

export type MenuGroup = {
  id: string
  /** Optional header naming the group. */
  title?: string
  items: MenuEntry[]
}

type MenuButtonProps = {
  /** The trigger's content: text, or an icon with `aria-label`. */
  label: ReactNode
  'aria-label'?: string
  /** Entries in groups; groups are separated by a rule. */
  groups: MenuGroup[]
  onAction: (id: string) => void
  /** Called instead of onAction when an unavailable entry is chosen. */
  onBlocked?: (entry: MenuEntry, reason: string) => void
  /** Checkable entries: "multiple" for toggles, "single" for one choice. */
  selectionMode?: 'none' | 'single' | 'multiple'
  selectedKeys?: Iterable<string>
  onSelectionChange?: (keys: Set<string>) => void
  /** Quiet triggers show no edge until hovered, for header and column icons. */
  variant?: 'default' | 'quiet'
  /** Shows a chevron after the label. */
  showChevron?: boolean
  placement?: 'bottom start' | 'bottom end' | 'top start' | 'top end'
  className?: string
}

function keysToSet(keys: Selection): Set<string> {
  return keys === 'all' ? new Set() : new Set([...keys].map(String))
}

/**
 * A button that opens a menu (decision 0027), in the look of the ribbon
 * menus: a check column, the label, an optional shortcut, and a second line
 * that carries the reason an entry is unavailable.
 */
export function MenuButton({
  label,
  'aria-label': ariaLabel,
  groups,
  onAction,
  onBlocked,
  selectionMode = 'none',
  selectedKeys,
  onSelectionChange,
  variant = 'default',
  showChevron = false,
  placement = 'bottom start',
  className,
}: MenuButtonProps) {
  const entries = new Map<Key, MenuEntry>(
    groups.flatMap((group) => group.items.map((item) => [item.id, item])),
  )
  const visible = groups.filter((group) => group.items.length > 0)
  return (
    <MenuTrigger>
      <Button
        aria-label={ariaLabel}
        className={cx(
          componentStyles.button,
          styles.menuTrigger,
          variant === 'quiet' && styles.quiet,
          className,
        )}
      >
        {label}
        {showChevron ? <ChevronDown size={12} aria-hidden="true" /> : null}
      </Button>
      <Popover
        className={cx(
          menuStyles.popover,
          placement.endsWith('end') && menuStyles.popoverEnd,
        )}
        placement={placement}
      >
        <Menu
          className={menuStyles.menu}
          selectionMode={selectionMode}
          // Choosing a checkable entry toggles it, so an unavailable one is
          // disabled there; its reason stays on its second line.
          disabledKeys={
            selectionMode === 'none'
              ? undefined
              : [...entries.values()]
                  .filter((entry) => entry.disabledReason)
                  .map((entry) => entry.id)
          }
          selectedKeys={selectedKeys ? [...selectedKeys] : undefined}
          onSelectionChange={
            onSelectionChange
              ? (keys) => onSelectionChange(keysToSet(keys))
              : undefined
          }
          onAction={(key) => {
            const entry = entries.get(key)
            if (!entry) return
            if (entry.disabledReason) {
              onBlocked?.(entry, entry.disabledReason)
              return
            }
            onAction(entry.id)
          }}
        >
          {visible.flatMap((group, index) => [
            index > 0 ? (
              <Separator
                key={`${group.id}-separator`}
                className={menuStyles.menuSeparator}
              />
            ) : null,
            <MenuSection key={group.id} id={group.id}>
              {group.title ? (
                <Header className={menuStyles.menuSectionHeader}>
                  {group.title}
                </Header>
              ) : null}
              {group.items.map((entry) => (
                <MenuItem
                  key={entry.id}
                  id={entry.id}
                  textValue={entry.label}
                  className={menuStyles.menuItem}
                >
                  {({ isSelected }) => (
                    <>
                      <span className={menuStyles.menuCheck} aria-hidden="true">
                        {isSelected ? <Check size={14} /> : null}
                      </span>
                      <Text slot="label" className={menuStyles.menuLabel}>
                        {entry.label}
                      </Text>
                      {entry.disabledReason || entry.description ? (
                        <Text
                          slot="description"
                          className={menuStyles.menuDescription}
                        >
                          {entry.disabledReason ?? entry.description}
                        </Text>
                      ) : null}
                      {entry.shortcut ? (
                        <Keyboard className={menuStyles.kbd}>
                          {entry.shortcut}
                        </Keyboard>
                      ) : null}
                    </>
                  )}
                </MenuItem>
              ))}
            </MenuSection>,
          ])}
        </Menu>
      </Popover>
    </MenuTrigger>
  )
}
