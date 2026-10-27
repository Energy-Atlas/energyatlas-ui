import { CheckCheck, Trash2 } from 'lucide-react'
import { useEffect, useId, useState } from 'react'
import { useStore } from 'zustand'
import {
  useLayoutVersion,
  useServices,
  useWorkbenchSnapshot,
} from '../WorkbenchContext.tsx'
import { TONE_META } from '../components/InlineAlert.tsx'
import { MenuButton } from '../components/MenuButton.tsx'
import { HeaderCount, PanelHeader } from '../components/PanelHeader.tsx'
import { SegmentedFilter } from '../components/SegmentedFilter.tsx'
import { Toolbar } from '../components/Toolbar.tsx'
import componentStyles from '../components/components.module.css'
import { cx } from '../cx.ts'
import { formatCount, formatTime } from '../format.ts'
import {
  MESSAGE_SOURCES,
  inScope,
  type Message,
  type MessageAction,
  type MessageSource,
} from '../messages/messageCenter.ts'
import { useRunMessageAction } from '../messages/useMessageActions.ts'
import styles from './messages.module.css'
import panelStyles from './panels.module.css'

type ToneFilter = 'all' | 'problems'
type SourceFilter = MessageSource | 'any'

function isProblem(message: Message): boolean {
  return message.tone === 'warning' || message.tone === 'danger'
}

const ACTORS = { manual: null, agent: 'by the agent', system: null } as const

type MessageRowProps = {
  message: Message
  onAction: (action: MessageAction) => void
}

/**
 * One message in the history: its tone, time, source, the text, and the
 * actions it offers again. A message that no longer needs attention, such as
 * an answered approval, is muted.
 */
export function MessageRow({ message, onAction }: MessageRowProps) {
  const tone = TONE_META[message.tone]
  const Icon = tone.icon
  const actor = ACTORS[message.actor]
  return (
    <li
      className={cx(styles.row, message.resolved && styles.resolved)}
      data-tone={message.tone}
    >
      <Icon
        size={14}
        role="img"
        aria-label={tone.label}
        className={styles.icon}
      />
      <div className={styles.body}>
        <p className={styles.meta}>
          <time dateTime={message.at}>{formatTime(message.at)}</time>
          <span>{MESSAGE_SOURCES[message.source]}</span>
          {actor ? <span>{actor}</span> : null}
          {message.resolved ? <span>Answered</span> : null}
        </p>
        <p className={styles.text}>{message.text}</p>
        {message.actions.length > 0 && !message.resolved ? (
          <div className={styles.actions}>
            {message.actions.map((action) => (
              <button
                key={action.label}
                type="button"
                className={componentStyles.button}
                onClick={() => onAction(action)}
              >
                {action.label}
              </button>
            ))}
          </div>
        ) : null}
      </div>
    </li>
  )
}

/**
 * The history of every message (decision 0027), docked on the right border
 * beside Reasoning and Inspection: this project's messages and the server's,
 * newest first, filtered by tone and source. Messages count as read while
 * the panel is on screen.
 */
export function MessagesPanel() {
  const headingId = useId()
  const { messages, layout } = useServices()
  useLayoutVersion()
  const runAction = useRunMessageAction()
  const projectId = useWorkbenchSnapshot(
    (snapshot) => snapshot.state.project.id,
  )
  const history = useStore(messages.store, (snapshot) => snapshot.messages)
  const [tone, setTone] = useState<ToneFilter>('all')
  const [source, setSource] = useState<SourceFilter>('any')
  const open = layout.isPanelOpen('messages')

  const scoped = history.filter((message) => inScope(message, projectId))
  const unread = scoped.filter((message) => !message.read).length
  useEffect(() => {
    if (open && unread > 0) messages.markRead({ projectId })
  }, [open, unread, messages, projectId])

  const bySource =
    source === 'any'
      ? scoped
      : scoped.filter((message) => message.source === source)
  const problems = bySource.filter(isProblem)
  const shown = (tone === 'problems' ? problems : bySource).toReversed()

  return (
    <section
      className={cx(panelStyles.panel, styles.panel)}
      aria-labelledby={headingId}
    >
      <PanelHeader
        title="Messages"
        headingId={headingId}
        meta={
          <HeaderCount>{formatCount(scoped.length, 'message')}</HeaderCount>
        }
        actions={
          <Toolbar
            aria-label="Messages"
            items={[
              {
                id: 'markRead',
                label: 'Mark all read',
                icon: CheckCheck,
                iconOnly: true,
                disabledReason:
                  unread > 0 ? null : 'Every message has been read.',
                onPress: () => messages.markRead({ projectId }),
              },
              {
                id: 'clear',
                label: 'Clear messages',
                icon: Trash2,
                iconOnly: true,
                disabledReason:
                  scoped.length > 0 ? null : 'There are no messages to clear.',
                onPress: () => messages.clear(projectId),
              },
            ]}
          />
        }
      />
      <div className={styles.filters}>
        <SegmentedFilter<ToneFilter>
          aria-label="Show messages"
          value={tone}
          onChange={setTone}
          segments={[
            { id: 'all', label: 'All', count: bySource.length },
            { id: 'problems', label: 'Problems', count: problems.length },
          ]}
        />
        <MenuButton
          label={`From: ${source === 'any' ? 'Anywhere' : MESSAGE_SOURCES[source]}`}
          aria-label={`Messages from: ${source === 'any' ? 'anywhere' : MESSAGE_SOURCES[source]}. Change.`}
          showChevron
          selectionMode="single"
          selectedKeys={[source]}
          onAction={(id) => setSource(id as SourceFilter)}
          groups={[
            {
              id: 'sources',
              items: [
                { id: 'any', label: 'Anywhere' },
                ...(Object.keys(MESSAGE_SOURCES) as MessageSource[]).map(
                  (id) => ({ id, label: MESSAGE_SOURCES[id] }),
                ),
              ],
            },
          ]}
        />
      </div>
      {shown.length > 0 ? (
        <ol className={styles.list} aria-label="Message history">
          {shown.map((message) => (
            <MessageRow
              key={message.id}
              message={message}
              onAction={runAction}
            />
          ))}
        </ol>
      ) : scoped.length === 0 ? (
        <p className={componentStyles.muted}>
          No messages yet. Finished jobs, failed requests, agent approvals, and
          the result of every operation appear here.
        </p>
      ) : (
        <p className={componentStyles.muted}>
          No messages match these filters.{' '}
          <button
            type="button"
            className={componentStyles.button}
            onClick={() => {
              setTone('all')
              setSource('any')
            }}
          >
            Show all
          </button>
        </p>
      )}
    </section>
  )
}
