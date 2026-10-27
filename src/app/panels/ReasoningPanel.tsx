import {
  Check,
  ChevronDown,
  ChevronRight,
  CircleCheck,
  CircleX,
  CornerDownLeft,
  Info,
  Link2,
  Plus,
  ShieldAlert,
  TriangleAlert,
  Wrench,
  X,
} from 'lucide-react'
import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import {
  Button,
  Label,
  Menu,
  MenuItem,
  MenuTrigger,
  Popover,
  Text,
  TextArea,
  TextField,
} from 'react-aria-components'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { useAgentSnapshot, useServices } from '../WorkbenchContext.tsx'
import {
  MODEL_OPTIONS,
  PERMISSION_MODES,
  permissionModeOption,
  SEND_MODES,
} from '../agent/modes.ts'
import { suggestNextSteps } from '../agent/suggestions.ts'
import { toolInputOf, toolTypeOf } from '../agent/tools.ts'
import type {
  PermissionMode,
  ReferenceTarget,
  TranscriptItem,
} from '../agent/types.ts'
import { ActionButton } from '../components/ActionButton.tsx'
import { CapabilityBadge } from '../components/CapabilityBadge.tsx'
import componentStyles from '../components/components.module.css'
import menuStyles from '../components/menus.module.css'
import { cx } from '../cx.ts'
import styles from './reasoning.module.css'

/** The prompt field grows to this many lines before it starts scrolling. */
const PROMPT_FIELD_MAX_ROWS = 6

/** Pressing the left half of the split button queues the message. */
const DEFAULT_SEND_MODE = 'queue'

type ToolItem = Extract<TranscriptItem, { kind: 'tool' }>

type EntryProps = {
  item: Exclude<TranscriptItem, ToolItem>
  onFollow: (target: ReferenceTarget) => void
  onApprove: (itemId: string) => void
  onDecline: (itemId: string) => void
}

/** Consecutive tool calls read as one log; everything else stays an entry. */
type TranscriptBlock =
  | { kind: 'entry'; item: Exclude<TranscriptItem, ToolItem> }
  | { kind: 'tools'; id: string; items: ToolItem[] }

function transcriptBlocks(items: TranscriptItem[]): TranscriptBlock[] {
  const blocks: TranscriptBlock[] = []
  for (const item of items) {
    const last = blocks.at(-1)
    if (item.kind !== 'tool') blocks.push({ kind: 'entry', item })
    else if (last?.kind === 'tools') last.items.push(item)
    else blocks.push({ kind: 'tools', id: item.id, items: [item] })
  }
  return blocks
}

/** One tool call: what it did, whether it applied, and its input on demand. */
function ToolCall({ item }: { item: ToolItem }) {
  const applied = item.result.status === 'applied'
  return (
    <li className={styles.tool} aria-label={`Tool call: ${item.title}`}>
      <div className={styles.toolRow}>
        <Wrench size={14} aria-hidden="true" className={styles.icon} />
        <span className={styles.toolTitle}>{item.title}</span>
        {applied ? (
          <span
            className={cx(componentStyles.state, componentStyles.stateQuiet)}
          >
            <CircleCheck size={12} aria-hidden="true" />
            Applied
          </span>
        ) : (
          <span
            className={cx(
              componentStyles.state,
              componentStyles.stateAttention,
              componentStyles.danger,
            )}
          >
            <CircleX size={12} aria-hidden="true" />
            Rejected
          </span>
        )}
      </div>
      <p className={styles.toolMeta}>
        {toolTypeOf(item.call)} ·{' '}
        {item.result.operationIds.join(', ') || 'no operation'}
      </p>
      {item.result.summary ? (
        <p className={styles.text}>{item.result.summary}</p>
      ) : null}
      {item.result.issues.map((issue) => (
        <p key={issue.message} className={styles.toolIssue}>
          {issue.message}
        </p>
      ))}
      <details className={styles.toolDetails}>
        <summary>Input</summary>
        <pre>{JSON.stringify(toolInputOf(item.call), null, 2)}</pre>
      </details>
    </li>
  )
}

/**
 * A run of consecutive tool calls, collapsed to "Used N tools" so the
 * conversation stays readable; a rejected call is named in the summary.
 */
function ToolCalls({ items }: { items: ToolItem[] }) {
  const rejected = items.filter(
    (item) => item.result.status !== 'applied',
  ).length
  return (
    <li className={styles.entry}>
      <details className={styles.toolGroup}>
        <summary className={styles.toolSummary}>
          <ChevronRight
            size={14}
            aria-hidden="true"
            className={styles.toolChevron}
          />
          <Wrench size={14} aria-hidden="true" className={styles.icon} />
          Used {items.length} tool{items.length === 1 ? '' : 's'}
          {rejected > 0 ? (
            <span className={styles.toolRejected}>· {rejected} rejected</span>
          ) : null}
        </summary>
        <ol
          className={styles.toolList}
          aria-label={`${items.length} tool call${items.length === 1 ? '' : 's'}`}
        >
          {items.map((item) => (
            <ToolCall key={item.id} item={item} />
          ))}
        </ol>
      </details>
    </li>
  )
}

function approvalLabel(
  item: Extract<TranscriptItem, { kind: 'approval' }>,
): string {
  if (item.status === 'pending') return 'Waiting for your approval'
  if (item.status === 'declined') return 'Rejected'
  return item.decidedBy
    ? `Approved by ${permissionModeOption(item.decidedBy).label} mode`
    : 'Approved'
}

function TranscriptEntry({ item, onFollow, onApprove, onDecline }: EntryProps) {
  switch (item.kind) {
    case 'user':
      return (
        <li className={cx(styles.entry, styles.user)}>
          <p className={styles.speaker}>You</p>
          <p className={styles.text}>{item.text}</p>
        </li>
      )
    case 'agent':
      return (
        <li className={styles.entry}>
          <p className={styles.speaker}>Agent</p>
          <div className={styles.markdown}>
            <Markdown remarkPlugins={[remarkGfm]}>{item.markdown}</Markdown>
          </div>
        </li>
      )
    case 'reasoning':
      return (
        <li className={cx(styles.entry, styles.reasoningStep)}>
          <details>
            <summary>Reasoning</summary>
            <p className={styles.text}>{item.text}</p>
          </details>
        </li>
      )
    case 'reference':
      return (
        <li className={styles.entry}>
          <button
            type="button"
            className={styles.linkButton}
            onClick={() => onFollow(item.target)}
          >
            <Link2 size={14} aria-hidden="true" className={styles.icon} />
            {item.label}
          </button>
        </li>
      )
    case 'approval':
      return (
        <li
          className={cx(
            styles.entry,
            styles.approval,
            item.status === 'pending' && styles.approvalPending,
          )}
          aria-label={item.title}
        >
          <p className={styles.approvalLabel}>
            <ShieldAlert size={14} aria-hidden="true" />
            {approvalLabel(item)}
          </p>
          <p className={styles.approvalTitle}>{item.title}</p>
          {item.description ? (
            <p className={styles.text}>{item.description}</p>
          ) : null}
          <ul className={styles.callList}>
            {item.callTitles.map((title, index) => (
              <li key={`${index}-${title}`}>{title}</li>
            ))}
          </ul>
          {item.status === 'pending' ? (
            <div className={styles.approvalActions}>
              <ActionButton
                label={`Approve: ${item.title}`}
                variant="primary"
                disabledReason={null}
                onPress={() => onApprove(item.id)}
              >
                Approve
              </ActionButton>
              <ActionButton
                label={`Reject: ${item.title}`}
                disabledReason={null}
                onPress={() => onDecline(item.id)}
              >
                Reject
              </ActionButton>
            </div>
          ) : null}
        </li>
      )
    case 'notice': {
      const Icon =
        item.tone === 'error'
          ? CircleX
          : item.tone === 'warning'
            ? TriangleAlert
            : Info
      return (
        <li
          className={cx(
            styles.entry,
            styles.notice,
            item.tone === 'error'
              ? styles.noticeError
              : item.tone === 'warning'
                ? styles.noticeWarning
                : styles.noticeInfo,
          )}
        >
          <Icon size={14} aria-hidden="true" className={styles.icon} />
          <span>{item.text}</span>
        </li>
      )
    }
  }
}

/**
 * Grows with its content up to PROMPT_FIELD_MAX_ROWS lines, then scrolls. The
 * border has to be added back because box-sizing is border-box while
 * scrollHeight covers only content and padding; without it the field is a
 * couple of pixels short and shows a scrollbar at every size.
 */
function usePromptField(value: string) {
  const ref = useRef<HTMLTextAreaElement>(null)
  useLayoutEffect(() => {
    const field = ref.current
    if (!field) return
    const computed = getComputedStyle(field)
    const lineHeight = parseFloat(computed.lineHeight) || 20
    const borders =
      parseFloat(computed.borderTopWidth) +
      parseFloat(computed.borderBottomWidth)
    const padding =
      parseFloat(computed.paddingTop) + parseFloat(computed.paddingBottom)
    const max = lineHeight * PROMPT_FIELD_MAX_ROWS + padding + borders
    field.style.height = 'auto'
    const natural = field.scrollHeight + borders
    field.style.height = `${Math.min(natural, max)}px`
    field.style.overflowY = natural > max ? 'auto' : 'hidden'
  }, [value])
  return ref
}

/** Picks the permission mode and explains each choice. */
function PermissionMenu({
  selected,
  onSelect,
}: {
  selected: PermissionMode
  onSelect: (mode: PermissionMode) => void
}) {
  return (
    <MenuTrigger>
      <Button
        className={styles.modeButton}
        aria-label={`Permission mode: ${permissionModeOption(selected).label}`}
      >
        {permissionModeOption(selected).label}
        <ChevronDown size={12} aria-hidden="true" />
      </Button>
      <Popover className={menuStyles.popover} placement="top start">
        <Menu
          className={menuStyles.menu}
          onAction={(key) => onSelect(key as PermissionMode)}
          selectionMode="single"
          selectedKeys={[selected]}
        >
          {PERMISSION_MODES.map((option) => (
            <MenuItem
              key={option.id}
              id={option.id}
              className={menuStyles.menuItem}
              textValue={option.label}
            >
              {({ isSelected }) => (
                <>
                  <span className={menuStyles.menuCheck} aria-hidden="true">
                    {isSelected ? <Check size={14} /> : null}
                  </span>
                  <Text slot="label" className={menuStyles.menuLabel}>
                    {option.label}
                  </Text>
                  <Text
                    slot="description"
                    className={menuStyles.menuDescription}
                  >
                    {option.description}
                  </Text>
                </>
              )}
            </MenuItem>
          ))}
        </Menu>
      </Popover>
    </MenuTrigger>
  )
}

/** Names the model answering. Only the scripted player can be chosen here. */
function ModelMenu({ label }: { label: string }) {
  const unavailable = MODEL_OPTIONS.filter(
    (option) => option.unavailableReason !== null,
  ).map((option) => option.id)
  return (
    <MenuTrigger>
      <Button className={styles.modeButton} aria-label={`Model: ${label}`}>
        {label}
        <ChevronDown size={12} aria-hidden="true" />
      </Button>
      <Popover className={menuStyles.popover} placement="top start">
        <Menu className={menuStyles.menu} disabledKeys={unavailable}>
          {MODEL_OPTIONS.map((option) => (
            <MenuItem
              key={option.id}
              id={option.id}
              className={menuStyles.menuItem}
              textValue={option.label}
            >
              <span className={menuStyles.menuCheck} aria-hidden="true" />
              <Text slot="label" className={menuStyles.menuLabel}>
                {option.label}
              </Text>
              {option.unavailableReason ? (
                <Text slot="description" className={menuStyles.menuDescription}>
                  {option.unavailableReason}
                </Text>
              ) : null}
            </MenuItem>
          ))}
        </Menu>
      </Popover>
    </MenuTrigger>
  )
}

/**
 * The Reasoning panel: the agent transcript with tool calls linked to
 * operation log entries, approvals, references, and a composer whose send
 * actions and permission mode decide when a message arrives and how much the
 * agent may do without asking (decisions 0005, 0006, 0011, and 0016).
 */
export function ReasoningPanel() {
  const { agent, layout, workbench, showInspection } = useServices()
  const status = useAgentSnapshot((snapshot) => snapshot.status)
  const transcript = useAgentSnapshot((snapshot) => snapshot.transcript)
  const presets = useAgentSnapshot((snapshot) => snapshot.presets)
  const permissionMode = useAgentSnapshot((snapshot) => snapshot.permissionMode)
  const queued = useAgentSnapshot((snapshot) => snapshot.queued)
  const ranSessionIds = useAgentSnapshot((snapshot) => snapshot.ranSessionIds)
  const [message, setMessage] = useState('')
  const endRef = useRef<HTMLDivElement>(null)
  const promptRef = usePromptField(message)
  const suggestionsLabelId = useId()
  const queueLabelId = useId()

  useEffect(() => {
    endRef.current?.scrollIntoView?.({ block: 'nearest' })
  }, [transcript.length])

  const suggestions = suggestNextSteps(presets, ranSessionIds)
  const busyReason =
    status === 'running'
      ? 'A session is running. Wait for it to finish or stop it.'
      : status === 'awaitingApproval'
        ? 'Answer the pending approval first.'
        : null

  const follow = (target: ReferenceTarget) => {
    switch (target.type) {
      case 'page':
        layout.openPage(target.page)
        return
      case 'stage':
        workbench.execute({
          type: 'workflow.setCurrentStage',
          input: { stageId: target.stageId },
        })
        layout.openPage('roadmap')
        return
      case 'inspection':
        showInspection()
        return
    }
  }

  /** Sends the message one specific way; a blocked send explains itself. */
  const sendVia = (mode: (typeof SEND_MODES)[number]['id'], label: string) => {
    const blocker = agent.sendBlocker(mode, message)
    if (blocker) {
      workbench.record({
        type: 'action.blocked',
        title: label,
        status: 'rejected',
        summary: '',
        issues: [{ path: '', message: blocker }],
      })
      return
    }
    agent.send(message, mode)
    setMessage('')
  }

  const defaultOption = SEND_MODES.find(
    (option) => option.id === DEFAULT_SEND_MODE,
  )!
  const defaultBlocked = agent.sendBlocker(DEFAULT_SEND_MODE, message) !== null

  return (
    <section className={styles.reasoning} aria-label="Reasoning">
      <header className={styles.agentHeader}>
        <p className={styles.agentName}>{agent.label}</p>
        <CapabilityBadge id="agent.sessions" />
      </header>

      {/* Scrollable once the composer takes height, so it must be reachable
          by keyboard (axe scrollable-region-focusable). */}
      <div
        role="log"
        aria-label="Agent transcript"
        className={styles.log}
        tabIndex={0}
      >
        {transcript.length === 0 ? (
          <p className={styles.intro}>
            Choose a suggested next step or type a request. Sessions replay tool
            calls through the same commands, view operations, and layout
            operations as the workbench controls, and what the agent may do
            without asking follows the permission mode below.
          </p>
        ) : (
          <ol className={styles.transcript}>
            {transcriptBlocks(transcript).map((block) =>
              block.kind === 'tools' ? (
                <ToolCalls key={block.id} items={block.items} />
              ) : (
                <TranscriptEntry
                  key={block.item.id}
                  item={block.item}
                  onFollow={follow}
                  onApprove={(itemId) => agent.approve(itemId)}
                  onDecline={(itemId) => agent.decline(itemId)}
                />
              ),
            )}
          </ol>
        )}
        <div ref={endRef} />
      </div>

      <div className={styles.controls}>
        <p id={suggestionsLabelId} className={styles.controlsLabel}>
          Suggested next steps based on your conversation
        </p>
        <ul className={styles.suggestions} aria-labelledby={suggestionsLabelId}>
          {suggestions.map((suggestion) => (
            <li key={suggestion.id}>
              <ActionButton
                label={`Start session: ${suggestion.label}`}
                disabledReason={busyReason}
                onPress={() => agent.startPreset(suggestion.id)}
              >
                {suggestion.label}
              </ActionButton>
            </li>
          ))}
        </ul>

        {queued.length > 0 ? (
          <>
            <p id={queueLabelId} className={styles.controlsLabel}>
              Waiting for the agent
            </p>
            <ul className={styles.queue} aria-labelledby={queueLabelId}>
              {queued.map((text, index) => (
                <li key={`${index}-${text}`} className={styles.queueItem}>
                  <span className={styles.queueText}>{text}</span>
                  <button
                    type="button"
                    className={styles.queueRemove}
                    aria-label={`Remove queued message: ${text}`}
                    onClick={() => agent.dropQueued(index)}
                  >
                    <X size={12} aria-hidden="true" />
                  </button>
                </li>
              ))}
            </ul>
          </>
        ) : null}

        <form
          className={styles.composer}
          onSubmit={(event) => {
            event.preventDefault()
            sendVia(DEFAULT_SEND_MODE, defaultOption.label)
          }}
        >
          {/* The field spans the panel, so every line wraps on the same
              margins as the text above it. */}
          <TextField
            className={styles.messageField}
            value={message}
            onChange={setMessage}
          >
            <Label className="visually-hidden">Message the agent</Label>
            <TextArea
              ref={promptRef}
              className={styles.messageInput}
              placeholder="Ask the agent"
              rows={1}
              maxLength={500}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.shiftKey) {
                  event.preventDefault()
                  sendVia(DEFAULT_SEND_MODE, defaultOption.label)
                }
              }}
            />
          </TextField>

          {/* Below the box: what a message carries, who approves, which model
              answers, and the send control. */}
          <div className={styles.composerTools}>
            <ActionButton
              label="Attach context to the message"
              disabledReason="Attaching documents, images, or selections to a message is planned."
              onPress={() => {}}
            >
              <Plus size={14} aria-hidden="true" />
            </ActionButton>
            <PermissionMenu
              selected={permissionMode}
              onSelect={(mode) => agent.setPermissionMode(mode)}
            />
            <ModelMenu label="Scripted" />
            {status !== 'idle' ? (
              <ActionButton
                label="Stop the agent session"
                disabledReason={null}
                onPress={() => agent.stop()}
              >
                Stop
              </ActionButton>
            ) : null}

            {/* One control, like ▶ Run ▾: the left half queues the message,
                the right half sends it a named way. */}
            <div
              className={cx(
                styles.sendSplit,
                defaultBlocked && styles.sendSplitIdle,
              )}
            >
              <button
                type="button"
                className={styles.sendPrimary}
                aria-label={defaultOption.label}
                aria-disabled={defaultBlocked ? true : undefined}
                title={
                  agent.sendBlocker(DEFAULT_SEND_MODE, message) ??
                  defaultOption.label
                }
                onClick={() => sendVia(DEFAULT_SEND_MODE, defaultOption.label)}
              >
                <CornerDownLeft size={14} aria-hidden="true" />
              </button>
              <MenuTrigger>
                <Button
                  className={styles.sendMenuButton}
                  aria-label="More send options"
                >
                  <ChevronDown size={14} aria-hidden="true" />
                </Button>
                <Popover className={menuStyles.popover} placement="top end">
                  <Menu
                    className={menuStyles.menu}
                    onAction={(key) => {
                      const option = SEND_MODES.find(
                        (candidate) => candidate.id === key,
                      )
                      if (option) sendVia(option.id, option.label)
                    }}
                  >
                    {SEND_MODES.map((option) => {
                      const blocker = agent.sendBlocker(option.id, message)
                      return (
                        <MenuItem
                          key={option.id}
                          id={option.id}
                          className={menuStyles.menuItem}
                          textValue={option.label}
                        >
                          <span
                            className={menuStyles.menuCheck}
                            aria-hidden="true"
                          />
                          <Text slot="label" className={menuStyles.menuLabel}>
                            {option.label}
                          </Text>
                          <Text
                            slot="description"
                            className={menuStyles.menuDescription}
                          >
                            {blocker ?? option.description}
                          </Text>
                        </MenuItem>
                      )
                    })}
                  </Menu>
                </Popover>
              </MenuTrigger>
            </div>
          </div>
        </form>
      </div>
    </section>
  )
}
