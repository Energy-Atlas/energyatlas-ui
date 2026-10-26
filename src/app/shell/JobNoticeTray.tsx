import { CircleCheck, CircleX, TriangleAlert, X } from 'lucide-react'
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

/**
 * Notices for finished jobs. They are announced politely and never take
 * focus; Open job selects the job on the Jobs page.
 */
export function JobNoticeTray() {
  const { jobNotices, view, layout } = useServices()
  const notices = useStore(jobNotices.store, (current) => current.notices)
  const projectId = useWorkbenchSnapshot(
    (snapshot) => snapshot.state.project.id,
  )
  const current = notices.filter((notice) => notice.projectId === projectId)

  return (
    <div role="status" aria-label="Job notices">
      <ul className={styles.noticeTray}>
        {current.map((notice) => {
          const tone = TONE[notice.tone]
          const Icon = tone.icon
          return (
            <li
              key={notice.id}
              className={cx(styles.jobNotice, tone.className)}
            >
              <Icon size={14} aria-hidden="true" />
              <span className={styles.jobNoticeText}>{notice.message}</span>
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
                  }}
                >
                  Open job
                </button>
                <button
                  type="button"
                  className={componentStyles.button}
                  aria-label={`Dismiss notice: ${notice.message}`}
                  onClick={() => jobNotices.dismiss(notice.id)}
                >
                  <X size={14} aria-hidden="true" />
                </button>
              </span>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
