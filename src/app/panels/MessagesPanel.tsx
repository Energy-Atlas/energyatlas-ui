import { CheckCheck, Trash2 } from 'lucide-react'
import { useEffect, useId, useState, type ReactNode } from 'react'
import { useStore } from 'zustand'
import {
  useLayoutVersion,
  useServices,
  useWorkbenchSnapshot,
} from '../WorkbenchContext.tsx'
import { LogView, type LogEntry } from '../components/LogView.tsx'
import { MenuButton } from '../components/MenuButton.tsx'
import { HeaderCount, PanelHeader } from '../components/PanelHeader.tsx'
import { Toolbar } from '../components/Toolbar.tsx'
import componentStyles from '../components/components.module.css'
import { formatCount } from '../format.ts'
import {
  MESSAGE_SOURCES,
  inScope,
  type Message,
  type MessageAction,
  type MessageSource,
} from '../messages/messageCenter.ts'
import { useRunMessageAction } from '../messages/useMessageActions.ts'
import styles from './messages.module.css'

type SourceFilter = MessageSource | 'any'

const ACTORS = { manual: null, agent: 'by the agent', system: null } as const

function messageEntry(
  message: Message,
  onAction: (action: MessageAction) => void,
): LogEntry {
  const actor = ACTORS[message.actor]
  return {
    id: message.id,
    at: message.at,
    level: message.tone,
    source: MESSAGE_SOURCES[message.source],
    tags: [actor, message.resolved ? 'Answered' : null].filter(
      (tag): tag is string => tag !== null,
    ),
    text: message.text,
    muted: message.resolved,
    actions:
      message.actions.length > 0 && !message.resolved
        ? message.actions.map((action) => (
            <button
              key={action.label}
              type="button"
              className={componentStyles.button}
              onClick={() => onAction(action)}
            >
              {action.label}
            </button>
          ))
        : undefined,
  }
}

type MessageHistoryProps = {
  messages: Message[]
  onAction: (action: MessageAction) => void
  /** Filters beside the level filter, such as the source. */
  tools?: ReactNode
  empty?: ReactNode
  className?: string
}

/**
 * Messages as a log (decision 0027): oldest first, following the newest,
 * with time, level, source, who acted, the text, and the actions each
 * message offers again; an answered approval is muted.
 */
export function MessageHistory({
  messages,
  onAction,
  tools,
  empty,
  className,
}: MessageHistoryProps) {
  return (
    <LogView
      aria-label="Message history"
      listLabel="Messages"
      className={className}
      entries={messages.map((message) => messageEntry(message, onAction))}
      levelFilter
      follow
      download={{ fileName: 'messages' }}
      tools={tools}
      empty={empty}
    />
  )
}

/**
 * The history of every message (decision 0027), docked on the right border
 * beside Reasoning and Inspection: this project's messages and the server's,
 * filtered by level and source. Messages count as read while the panel is on
 * screen.
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
  const [source, setSource] = useState<SourceFilter>('any')
  const open = layout.isPanelOpen('messages')

  const scoped = history.filter((message) => inScope(message, projectId))
  const unread = scoped.filter((message) => !message.read).length
  useEffect(() => {
    if (open && unread > 0) messages.markRead({ projectId })
  }, [open, unread, messages, projectId])

  const shown =
    source === 'any'
      ? scoped
      : scoped.filter((message) => message.source === source)
  const sourceName = source === 'any' ? 'Anywhere' : MESSAGE_SOURCES[source]

  return (
    <section className={styles.panel} aria-labelledby={headingId}>
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
      <MessageHistory
        className={styles.history}
        messages={shown}
        onAction={runAction}
        tools={
          <MenuButton
            label={`From: ${sourceName}`}
            aria-label={`Messages from: ${sourceName.toLowerCase()}. Change.`}
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
        }
        empty={
          scoped.length === 0 ? (
            'No messages yet. Finished jobs, failed requests, agent approvals, and the result of every operation appear here.'
          ) : (
            <>
              No messages from {sourceName.toLowerCase()}.{' '}
              <button
                type="button"
                className={componentStyles.button}
                onClick={() => setSource('any')}
              >
                Show all
              </button>
            </>
          )
        }
      />
    </section>
  )
}
