import { CircleCheck, CircleX, TriangleAlert, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useStore } from 'zustand'
import { useServices, useWorkbenchSnapshot } from '../WorkbenchContext.tsx'
import componentStyles from '../components/components.module.css'
import { cx } from '../cx.ts'
import type { JobNoticeTone } from '../jobs/jobNotices.ts'
import styles from './shell.module.css'

const TONE = {
  success: { icon: CircleCheck, className: undefined },
  warning: { icon: TriangleAlert, className: styles.jobNoticeWarning },
  danger: { icon: CircleX, className: styles.jobNoticeDanger },
} satisfies Record<JobNoticeTone, unknown>

/** Where focus goes after a notice it was on disappears. */
type Refocus = 'next' | 'jobs' | null

/**
 * Notices for finished jobs, in a strip above the status bar. The message is
 * announced politely and never takes focus; Open job selects the job on the
 * Jobs page. Focus on a dismissed notice moves to the next one, or back to
 * the workspace, so the keyboard is never stranded.
 */
export function JobNoticeTray() {
  const { jobNotices, view, layout } = useServices()
  const notices = useStore(jobNotices.store, (current) => current.notices)
  const projectId = useWorkbenchSnapshot(
    (snapshot) => snapshot.state.project.id,
  )
  const dismissRef = useRef<HTMLButtonElement>(null)
  const refocus = useRef<Refocus>(null)
  // Bumped by a dismissal so the effect runs after the strip re-renders.
  const [dismissals, setDismissals] = useState(0)
  // The newest notice shows; dismissing it reveals the next.
  const current = notices.filter((notice) => notice.projectId === projectId)
  const notice = current[0]
  const earlier = current.length - 1

  useEffect(() => {
    const where = refocus.current
    if (!where) return
    refocus.current = null
    const target =
      where === 'jobs'
        ? document.querySelector<HTMLElement>(
            '[role="listbox"][aria-label="Jobs"]',
          )
        : (dismissRef.current ??
          document.querySelector<HTMLElement>('main[aria-label="Workspace"]'))
    target?.focus()
  }, [dismissals])

  const tone = notice ? TONE[notice.tone] : null
  const Icon = tone?.icon

  return (
    <>
      <div role="status" className="visually-hidden">
        {notice?.message ?? ''}
      </div>
      {notice && tone && Icon ? (
        <section
          aria-label="Job notices"
          className={cx(styles.jobNotice, tone.className)}
        >
          <Icon size={14} aria-hidden="true" />
          <span className={styles.jobNoticeText}>
            {notice.message}
            {earlier > 0 ? (
              <span className={componentStyles.muted}>
                {' '}
                ({earlier} earlier notice{earlier === 1 ? '' : 's'})
              </span>
            ) : null}
          </span>
          <span className={styles.jobNoticeActions}>
            <button
              type="button"
              className={componentStyles.button}
              onClick={() => {
                const result = view.execute({
                  type: 'jobs.select',
                  input: { taskId: notice.taskId },
                })
                if (result.outcome.status === 'applied') {
                  view.execute({
                    type: 'jobs.setFilter',
                    input: { filter: 'all' },
                  })
                  layout.openPage('tasks')
                }
                jobNotices.dismiss(notice.id)
                refocus.current = 'jobs'
                setDismissals((count) => count + 1)
              }}
            >
              Open job
            </button>
            <button
              ref={dismissRef}
              type="button"
              className={componentStyles.button}
              aria-label={`Dismiss notice: ${notice.message}`}
              onClick={() => {
                jobNotices.dismiss(notice.id)
                refocus.current = 'next'
                setDismissals((count) => count + 1)
              }}
            >
              <X size={14} aria-hidden="true" />
            </button>
          </span>
        </section>
      ) : null}
    </>
  )
}
