import { Check, ChevronDown, ChevronRight, Play } from 'lucide-react'
import type { ReactNode } from 'react'
import {
  Button,
  Keyboard,
  Menu,
  MenuItem,
  MenuTrigger,
  Popover,
  Separator,
  SubmenuTrigger,
  Text,
  Toolbar,
} from 'react-aria-components'
import { useWorkbenchSnapshot } from '../WorkbenchContext.tsx'
import { ACTION_GROUPS, type AppAction } from '../actions.ts'
import { cx } from '../cx.ts'
import { AccountAvatar } from '../components/AccountAvatar.tsx'
import { DEMO_ACCOUNT } from '../demoAccount.ts'
import { toAriaKeyShortcut } from '../shortcuts.ts'
import menuStyles from '../components/menus.module.css'
import { unavailableRef } from '../components/unavailable.ts'
import styles from './shell.module.css'
import markUrl from '../../assets/brand/energyatlas-mark.svg'

const RUN_SPLIT = 'run.split'

// The Run split button (guidelines section 9) sits where the run quick button was.
const QUICK_ACTION_IDS = [
  'file.save',
  'edit.undo',
  'edit.redo',
  RUN_SPLIT,
  'view.toggleLeftSide',
  'view.toggleRightSide',
  'view.toggleMaximize',
  'view.resetLayout',
  'view.fullScreen',
  'help.comments',
]

type RibbonProps = {
  actions: AppAction[]
  invoke: (action: AppAction) => void
}

export function Ribbon({
  actions,
  invoke,
  projectHeading = true,
}: RibbonProps & {
  /** False on the start screen, whose own heading names it. */
  projectHeading?: boolean
}) {
  const projectName = useWorkbenchSnapshot(
    (snapshot) => snapshot.state.project.name,
  )
  const palette = actions.find((action) => action.id === 'help.palette')

  return (
    <header className={styles.ribbon}>
      <div className={styles.brand}>
        <img className={styles.brandMark} src={markUrl} alt="EnergyAtlas" />
        {/* The mark alone is shown; the project name stays the page heading. */}
        {projectHeading ? (
          <h1 className="visually-hidden">{projectName}</h1>
        ) : null}
      </div>
      <Toolbar aria-label="Workbench commands" className={styles.toolbar}>
        {ACTION_GROUPS.map((group) => (
          <ActionMenu
            key={group}
            label={group}
            actions={actions.filter((action) => action.group === group)}
            invoke={invoke}
            trigger={group}
            triggerClassName={styles.menuButton}
          />
        ))}
        <Separator orientation="vertical" className={styles.separator} />
        {palette ? (
          <button
            type="button"
            className={styles.searchButton}
            aria-keyshortcuts={toAriaKeyShortcut(palette.shortcut ?? '')}
            onClick={() => invoke(palette)}
          >
            Search commands
            <kbd className={menuStyles.kbd}>{palette.shortcut}</kbd>
          </button>
        ) : null}
        <Separator orientation="vertical" className={styles.separator} />
        {QUICK_ACTION_IDS.map((id) => {
          if (id === RUN_SPLIT) {
            return <RunSplitButton key={id} actions={actions} invoke={invoke} />
          }
          const action = actions.find((candidate) => candidate.id === id)
          return action ? (
            <QuickButton key={id} action={action} invoke={invoke} />
          ) : null
        })}
      </Toolbar>
      <AccountMenu actions={actions} invoke={invoke} />
    </header>
  )
}

/** The demo account's initials in a circle; its menu matches the ribbon menus. */
function AccountMenu({ actions, invoke }: RibbonProps) {
  const name = `Account: ${DEMO_ACCOUNT.name} (demo)`
  return (
    <div className={styles.account}>
      <ActionMenu
        label="Account"
        actions={actions.filter((action) => action.group === 'Account')}
        invoke={invoke}
        trigger={
          // The initials carry the tooltip; the button carries the name.
          <AccountAvatar title={name} />
        }
        triggerClassName={styles.avatarButton}
        triggerAriaLabel={name}
        placement="bottom end"
      />
    </div>
  )
}

function QuickButton({
  action,
  invoke,
}: {
  action: AppAction
  invoke: (action: AppAction) => void
}) {
  const Icon = action.icon
  const hint = action.shortcut ? ` (${action.shortcut})` : ''
  return (
    <button
      type="button"
      className={styles.quickButton}
      aria-label={action.label}
      aria-pressed={action.pressed}
      aria-disabled={action.disabledReason ? true : undefined}
      aria-keyshortcuts={
        action.shortcut ? toAriaKeyShortcut(action.shortcut) : undefined
      }
      title={action.disabledReason ?? `${action.label}${hint}`}
      onClick={() => invoke(action)}
    >
      {Icon ? <Icon size={16} aria-hidden="true" /> : action.label}
    </button>
  )
}

/** ▶ Run ▾: runs the current stage; the menu lists every Run action. */
function RunSplitButton({ actions, invoke }: RibbonProps) {
  const primary = actions.find((action) => action.id === 'run.current')
  if (!primary) return null
  const hint = primary.shortcut ? ` (${primary.shortcut})` : ''
  return (
    <div
      className={cx(
        styles.runSplit,
        primary.disabledReason !== null && styles.runSplitIdle,
      )}
    >
      <button
        type="button"
        className={styles.runPrimary}
        aria-label={primary.label}
        aria-disabled={primary.disabledReason ? true : undefined}
        aria-keyshortcuts={
          primary.shortcut ? toAriaKeyShortcut(primary.shortcut) : undefined
        }
        title={primary.disabledReason ?? `${primary.label}${hint}`}
        onClick={() => invoke(primary)}
      >
        <Play size={14} aria-hidden="true" />
        Run
      </button>
      <ActionMenu
        label="Run options"
        actions={actions.filter((action) => action.group === 'Run')}
        invoke={invoke}
        trigger={<ChevronDown size={14} aria-hidden="true" />}
        triggerClassName={styles.runMenuButton}
        triggerAriaLabel="More run options"
      />
    </div>
  )
}

/**
 * One menu row: check mark, label, and shortcut. An unavailable row is
 * greyed out with its reason as the tooltip and its description for
 * assistive technology (decision 0028); choosing it reports the reason.
 */
function ActionItem({ action }: { action: AppAction }) {
  return (
    <MenuItem
      id={action.id}
      textValue={action.label}
      className={cx(
        menuStyles.menuItem,
        action.disabledReason && menuStyles.unavailable,
      )}
      ref={unavailableRef(action.disabledReason)}
    >
      <span className={menuStyles.menuCheck} aria-hidden="true">
        {action.pressed ? <Check size={14} /> : null}
      </span>
      <Text slot="label" className={menuStyles.menuLabel}>
        {action.label}
        {action.pressed ? <span className="visually-hidden"> (on)</span> : null}
      </Text>
      {action.disabledReason ? (
        <Text slot="description" className="visually-hidden">
          {action.disabledReason}
        </Text>
      ) : null}
      {action.shortcut ? (
        <Keyboard className={menuStyles.kbd}>{action.shortcut}</Keyboard>
      ) : null}
    </MenuItem>
  )
}

function ActionMenu({
  label,
  actions,
  invoke,
  trigger,
  triggerClassName,
  triggerAriaLabel,
  placement = 'bottom start',
}: {
  label: string
  actions: AppAction[]
  invoke: (action: AppAction) => void
  trigger: ReactNode
  triggerClassName: string | undefined
  triggerAriaLabel?: string
  placement?: 'bottom start' | 'bottom end'
}) {
  const onAction = (key: React.Key) => {
    const action = actions.find((candidate) => candidate.id === key)
    if (action) invoke(action)
  }

  return (
    <MenuTrigger>
      <Button className={triggerClassName} aria-label={triggerAriaLabel}>
        {trigger}
      </Button>
      <Popover
        className={cx(
          menuStyles.popover,
          placement === 'bottom end' && menuStyles.popoverEnd,
        )}
        placement={placement}
      >
        <MenuLevel
          label={label}
          actions={actions}
          depth={0}
          onAction={onAction}
        />
      </Popover>
    </MenuTrigger>
  )
}

/**
 * One menu level: actions whose path ends here, then a submenu per next path
 * segment, so ['Appearance', 'Theme'] nests two deep like a desktop menu.
 */
function MenuLevel({
  label,
  actions,
  depth,
  onAction,
}: {
  label: string
  actions: AppAction[]
  depth: number
  onAction: (key: React.Key) => void
}) {
  const here = actions.filter(
    (action) => (action.menuPath ?? []).length === depth,
  )
  const submenus = [
    ...new Set(
      actions.flatMap((action) => {
        const segment = (action.menuPath ?? [])[depth]
        return segment ? [segment] : []
      }),
    ),
  ]

  return (
    <Menu
      aria-label={`${label} menu`}
      className={menuStyles.menu}
      onAction={onAction}
    >
      {here.map((action) => (
        <ActionItem key={action.id} action={action} />
      ))}
      {submenus.map((submenu) => (
        <SubmenuTrigger key={submenu}>
          <MenuItem textValue={submenu} className={menuStyles.menuItem}>
            <span className={menuStyles.menuCheck} aria-hidden="true" />
            <Text slot="label" className={menuStyles.menuLabel}>
              {submenu}
            </Text>
            <ChevronRight
              size={14}
              aria-hidden="true"
              className={menuStyles.submenuChevron}
            />
          </MenuItem>
          <Popover className={menuStyles.popover} placement="right top">
            <MenuLevel
              label={submenu}
              actions={actions.filter(
                (action) => (action.menuPath ?? [])[depth] === submenu,
              )}
              depth={depth + 1}
              onAction={onAction}
            />
          </Popover>
        </SubmenuTrigger>
      ))}
    </Menu>
  )
}
