import { Copy, Download } from 'lucide-react'
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { downloadText, fileSlug } from '../csv.ts'
import { cx } from '../cx.ts'
import { formatTime } from '../format.ts'
import { TONE_META, type Tone } from './InlineAlert.tsx'
import { ScrollJump } from './ScrollJump.tsx'
import { SegmentedFilter } from './SegmentedFilter.tsx'
import { Toolbar, type ToolbarItem } from './Toolbar.tsx'
import styles from './logView.module.css'

export type LogLevel = Tone

export type LogEntry = {
  id: string
  /** ISO time; entries without one leave the time column empty. */
  at?: string | null
  level: LogLevel
  /** Where the line came from, such as a tool or a message source. */
  source?: string
  text: string
  /** A second, muted line. */
  description?: string
  /** A longer body read on demand, such as a tool call's input. */
  detail?: { label: string; content: string }
  /** Buttons the line offers, such as Open job. */
  actions?: ReactNode
  /** Muted: the line no longer needs attention. */
  muted?: boolean
  /** Short markers after the source, such as who acted. */
  tags?: string[]
  /** An accessible name for the line, when its text alone is ambiguous. */
  label?: string
}

type LevelFilter = 'all' | 'problems'

type LogViewProps = {
  /** Names the scrolling log region. */
  'aria-label': string
  /** Names the list of lines, such as "Log of Preprocessing, attempt 2". */
  listLabel?: string
  /** Oldest first, as lines arrive. */
  entries: LogEntry[]
  /** Offers All and Problems (warnings and errors). */
  levelFilter?: boolean
  /**
   * Opens at the newest line and keeps it in view as lines arrive, while the
   * reader is at the end; scrolling up stops following until they return.
   */
  follow?: boolean
  /** Offers Copy and, with a file name, Download as text. */
  copyable?: boolean
  download?: { fileName: string } | null
  /** Shown when there are no lines. */
  empty?: ReactNode
  /**
   * Scrolls within its own height (a region the keyboard reaches); false for
   * a short log inside another scrolling view.
   */
  scrollable?: boolean
  /** Also placed in the tool bar, such as a source filter. */
  tools?: ReactNode
  className?: string
}

const PROBLEMS = new Set<LogLevel>(['warning', 'danger'])

/** The plain text of lines, one per line, for Copy and Download. */
export function logText(entries: LogEntry[]): string {
  return entries
    .map((entry) =>
      [
        entry.at ? new Date(entry.at).toISOString() : null,
        TONE_META[entry.level].label.toUpperCase(),
        entry.source ?? null,
        entry.text,
        entry.description ?? null,
      ]
        .filter((part) => part !== null && part !== '')
        .join('  '),
    )
    .join('\n')
}

/**
 * Log output (decision 0027): the job log, the agent's tool calls, and the
 * message history. Lines in the mono face with time, level, source, and
 * text; an optional level filter; the newest line followed until the reader
 * scrolls up; Copy and Download as text.
 */
export function LogView({
  'aria-label': ariaLabel,
  listLabel,
  entries,
  levelFilter = false,
  follow = false,
  copyable = true,
  download = null,
  empty,
  scrollable = true,
  tools,
  className,
}: LogViewProps) {
  const [level, setLevel] = useState<LevelFilter>('all')
  const [notice, setNotice] = useState('')
  const scrollRef = useRef<HTMLDivElement>(null)
  // Whether the reader is at the end, so new lines should stay in view.
  const atEnd = useRef(true)

  const problems = entries.filter((entry) => PROBLEMS.has(entry.level))
  const shown = level === 'problems' ? problems : entries

  useLayoutEffect(() => {
    const scroller = scrollRef.current
    if (!follow || !scroller || !atEnd.current) return
    scroller.scrollTop = scroller.scrollHeight
  }, [follow, shown.length, level])

  useEffect(() => {
    if (!notice) return
    const timer = window.setTimeout(() => setNotice(''), 4000)
    return () => window.clearTimeout(timer)
  }, [notice])

  const items: ToolbarItem[] = [
    ...(copyable
      ? [
          {
            id: 'copy',
            label: 'Copy lines',
            icon: Copy,
            iconOnly: true,
            disabledReason:
              shown.length > 0 ? null : 'There are no lines to copy.',
            onPress: () => {
              void navigator.clipboard?.writeText(logText(shown)).then(
                () =>
                  setNotice(
                    `Copied ${shown.length} line${shown.length === 1 ? '' : 's'}.`,
                  ),
                () => setNotice('The browser did not allow copying.'),
              )
            },
          },
        ]
      : []),
    ...(download
      ? [
          {
            id: 'download',
            label: 'Download as text',
            icon: Download,
            iconOnly: true,
            disabledReason:
              shown.length > 0 ? null : 'There are no lines to download.',
            onPress: () => {
              downloadText(
                `${fileSlug(download.fileName)}.txt`,
                `${logText(shown)}\n`,
                'text/plain',
              )
              setNotice(
                `Downloaded ${shown.length} line${shown.length === 1 ? '' : 's'}.`,
              )
            },
          },
        ]
      : []),
  ]

  return (
    <div className={cx(styles.view, className)}>
      {levelFilter || tools || items.length > 0 ? (
        <div className={styles.bar}>
          {levelFilter ? (
            <SegmentedFilter<LevelFilter>
              aria-label={`Show lines of ${ariaLabel}`}
              value={level}
              onChange={setLevel}
              segments={[
                { id: 'all', label: 'All', count: entries.length },
                { id: 'problems', label: 'Problems', count: problems.length },
              ]}
            />
          ) : null}
          {tools}
          {items.length > 0 ? (
            <div className={styles.tools}>
              <Toolbar aria-label={`${ariaLabel} tools`} items={items} />
            </div>
          ) : null}
        </div>
      ) : null}
      <div role="status" className="visually-hidden">
        {notice}
      </div>
      <div className={cx(scrollable && styles.scrollFrame)}>
        <div
          ref={scrollRef}
          role={scrollable ? 'log' : undefined}
          aria-label={scrollable ? ariaLabel : undefined}
          className={cx(scrollable && styles.scroll)}
          data-log-scroller=""
          // Scrollable, so it must be reachable by keyboard.
          tabIndex={scrollable ? 0 : undefined}
          onScroll={(event) => {
            const scroller = event.currentTarget
            atEnd.current =
              scroller.scrollTop + scroller.clientHeight >=
              scroller.scrollHeight - 4
          }}
        >
          <LogLines
            entries={entries}
            shown={shown}
            empty={empty}
            onShowAll={() => setLevel('all')}
            listLabel={listLabel}
          />
        </div>
        {scrollable ? (
          <ScrollJump label={ariaLabel} scroller="[data-log-scroller]" />
        ) : null}
      </div>
    </div>
  )
}

function LogLines({
  entries,
  shown,
  empty,
  onShowAll,
  listLabel,
}: {
  entries: LogEntry[]
  shown: LogEntry[]
  empty: ReactNode
  onShowAll: () => void
  listLabel: string | undefined
}) {
  if (shown.length > 0) {
    return (
      <ol className={styles.lines} aria-label={listLabel}>
        {shown.map((entry) => (
          <LogLine key={entry.id} entry={entry} />
        ))}
      </ol>
    )
  }
  return (
    <div className={styles.empty}>
      {entries.length === 0 ? (
        (empty ?? 'No lines yet.')
      ) : (
        <>
          No warnings or errors.{' '}
          <button
            type="button"
            className={styles.linkButton}
            onClick={onShowAll}
          >
            Show all
          </button>
        </>
      )}
    </div>
  )
}

function LogLine({ entry }: { entry: LogEntry }) {
  const tone = TONE_META[entry.level]
  const Icon = tone.icon
  return (
    <li
      className={cx(
        styles.line,
        entry.muted && styles.muted,
        !entry.at && styles.untimed,
      )}
      data-level={entry.level}
      aria-label={entry.label}
    >
      {entry.at ? (
        <time className={styles.time} dateTime={entry.at}>
          {formatTime(entry.at)}
        </time>
      ) : null}
      <Icon
        size={12}
        role="img"
        aria-label={tone.label}
        className={styles.level}
      />
      <div className={styles.body}>
        {entry.source || entry.tags?.length ? (
          <span className={styles.source}>
            {[entry.source, ...(entry.tags ?? [])].filter(Boolean).join(' Â· ')}
          </span>
        ) : null}
        <span className={styles.text}>{entry.text}</span>
        {entry.description ? (
          <span className={styles.description}>{entry.description}</span>
        ) : null}
        {entry.detail ? (
          <details className={styles.detail}>
            <summary>{entry.detail.label}</summary>
            <pre>{entry.detail.content}</pre>
          </details>
        ) : null}
        {entry.actions ? (
          <span className={styles.actions}>{entry.actions}</span>
        ) : null}
      </div>
    </li>
  )
}
