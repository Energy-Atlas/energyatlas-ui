import { ArrowDown, ArrowUp, Copy, Plus, Trash2 } from 'lucide-react'
import type { ReactNode } from 'react'
import { ReorderableList } from './ReorderableList.tsx'
import { Toolbar, type ToolbarItem } from './Toolbar.tsx'
import styles from './ruleList.module.css'

export type RuleListItem = {
  id: string
  name: string
  enabled: boolean
  /** The rule's conditions in words, such as "Use equals Office". */
  summary: string
  /** What the rule does now, such as "Takes 80 buildings". */
  effect?: string
}

type RuleListProps = {
  'aria-label': string
  rules: RuleListItem[]
  selectedId: string | null
  onSelect: (id: string) => void
  onToggle: (id: string, enabled: boolean) => void
  /** Moves a rule to a position counted from the top (0 is tried first). */
  onMove: (id: string, position: number) => void
  onAdd: () => void
  onDuplicate: (id: string) => void
  onRemove: (id: string) => void
  /** What a rule is called in labels, such as "rule". */
  noun?: string
  /** Why rules cannot change now, such as a request in flight or a run. */
  disabledReason?: string | null
  /** More actions after the shared ones, such as Generate default rules. */
  extraItems?: ToolbarItem[]
  onBlocked?: (item: ToolbarItem, reason: string) => void
  /** Shown instead of the list when there are no rules. */
  empty: ReactNode
  className?: string
}

/**
 * An ordered list of assignment rules, shared by archetype and scenario rules
 * (decision 0032): rules are tried top first. Each row has a drag handle, an
 * on/off switch, the rule's name with its position, and its conditions and
 * effect; the chosen rule is edited elsewhere (in Properties). New, Duplicate,
 * Remove, Move up, and Move down act on the chosen rule; rows also move by
 * dragging the handle or, from the keyboard, Enter on the handle, arrows,
 * and Enter.
 */
export function RuleList({
  'aria-label': ariaLabel,
  rules,
  selectedId,
  onSelect,
  onToggle,
  onMove,
  onAdd,
  onDuplicate,
  onRemove,
  noun = 'rule',
  disabledReason = null,
  extraItems = [],
  onBlocked,
  empty,
  className,
}: RuleListProps) {
  const index = rules.findIndex((rule) => rule.id === selectedId)
  const chosen = index >= 0 ? rules[index] : undefined
  const needsChoice = chosen ? null : `Choose a ${noun} first.`
  const items: ToolbarItem[] = [
    {
      id: 'add',
      label: `New ${noun}`,
      ariaLabel: `New ${noun} at the top`,
      icon: Plus,
      primary: true,
      disabledReason,
      onPress: onAdd,
    },
    {
      id: 'duplicate',
      label: 'Duplicate',
      ariaLabel: chosen ? `Duplicate ${chosen.name}` : `Duplicate ${noun}`,
      icon: Copy,
      group: 'edit',
      disabledReason: needsChoice ?? disabledReason,
      onPress: () => chosen && onDuplicate(chosen.id),
    },
    {
      id: 'remove',
      label: 'Remove',
      ariaLabel: chosen ? `Remove ${chosen.name}` : `Remove ${noun}`,
      icon: Trash2,
      group: 'edit',
      disabledReason: needsChoice ?? disabledReason,
      onPress: () => chosen && onRemove(chosen.id),
    },
    {
      id: 'up',
      label: 'Move up',
      ariaLabel: chosen ? `Move ${chosen.name} up` : `Move ${noun} up`,
      icon: ArrowUp,
      group: 'order',
      disabledReason:
        needsChoice ??
        (index === 0 ? `"${chosen?.name}" is already tried first.` : null) ??
        disabledReason,
      onPress: () => chosen && onMove(chosen.id, index - 1),
    },
    {
      id: 'down',
      label: 'Move down',
      ariaLabel: chosen ? `Move ${chosen.name} down` : `Move ${noun} down`,
      icon: ArrowDown,
      group: 'order',
      disabledReason:
        needsChoice ??
        (index === rules.length - 1
          ? `"${chosen?.name}" is already tried last.`
          : null) ??
        disabledReason,
      onPress: () => chosen && onMove(chosen.id, index + 1),
    },
    ...extraItems,
  ]
  return (
    <div className={[styles.frame, className].filter(Boolean).join(' ')}>
      <Toolbar
        aria-label={`${ariaLabel} actions`}
        items={items}
        onBlocked={onBlocked}
      />
      <ReorderableList
        aria-label={ariaLabel}
        items={rules.map((rule, position) => ({
          id: rule.id,
          title: rule.name,
          marker: `${position + 1}.`,
          meta: [rule.summary, rule.enabled ? rule.effect : 'Off']
            .filter(Boolean)
            .join(' · '),
          checked: rule.enabled,
        }))}
        selectedId={selectedId}
        onSelect={onSelect}
        checkLabel={(item) => `Use ${item.title}`}
        onCheck={(id, checked) => {
          if (disabledReason) {
            const rule = rules.find((each) => each.id === id)
            onBlocked?.(
              {
                id: 'toggle',
                label: `Switch ${rule?.name ?? noun}`,
                onPress: () => undefined,
              },
              disabledReason,
            )
            return
          }
          onToggle(id, checked)
        }}
        onMove={(id, position) => {
          if (disabledReason) {
            const rule = rules.find((each) => each.id === id)
            onBlocked?.(
              {
                id: 'move',
                label: `Move ${rule?.name ?? noun}`,
                onPress: () => undefined,
              },
              disabledReason,
            )
            return
          }
          onMove(id, position)
        }}
        empty={empty}
      />
    </div>
  )
}
