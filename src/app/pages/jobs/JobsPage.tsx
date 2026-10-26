import { useId } from 'react'
import {
  useServices,
  useViewState,
  useWorkbenchSnapshot,
} from '../../WorkbenchContext.tsx'
import { CapabilityBadge } from '../../components/CapabilityBadge.tsx'
import componentStyles from '../../components/components.module.css'
import { PanelHeader } from '../../components/PanelHeader.tsx'
import { SegmentedFilter } from '../../components/SegmentedFilter.tsx'
import { JOB_FILTERS, type JobFilter } from '../../view/viewOperations.ts'
import { groupOf, itemNoun } from '../../../domain/jobs/runGroups.ts'
import { JobDetail } from './JobDetail.tsx'
import { JobList } from './JobList.tsx'
import { listJobs, shownJob } from './jobView.ts'
import styles from './jobs.module.css'

/**
 * The server's jobs (decision 0025): a list with the selected job's detail
 * beside it, stacked when the page is narrow. The component id stays
 * `page.tasks`.
 */
export function JobsPage() {
  const headingId = useId()
  const detailHeadingId = useId()
  const { view } = useServices()
  const state = useWorkbenchSnapshot((snapshot) => snapshot.state)
  const filter = useViewState((current) => current.jobs.filter)
  const selectedTaskId = useViewState((current) => current.jobs.selectedTaskId)
  const jobs = listJobs(state, filter)
  const selected = shownJob(state, selectedTaskId, filter)
  const total = state.taskIds.length

  return (
    <section
      className={`${componentStyles.page} ${styles.page}`}
      aria-labelledby={headingId}
    >
      <PanelHeader
        className={styles.header}
        title="Jobs"
        headingId={headingId}
        meta={<CapabilityBadge id="workflow.stageRuns" />}
        actions={
          <SegmentedFilter
            aria-label="Show jobs"
            segments={(Object.keys(JOB_FILTERS) as JobFilter[]).map((id) => ({
              id,
              label: JOB_FILTERS[id],
              count: listJobs(state, id).length,
            }))}
            value={filter}
            onChange={(value) =>
              view.execute({ type: 'jobs.setFilter', input: { filter: value } })
            }
          />
        }
      />
      {total === 0 ? (
        <p className={componentStyles.empty}>
          No jobs yet. Run a workflow stage to start one; jobs run one at a time
          in the order submitted.
        </p>
      ) : (
        <div className={styles.split}>
          <div className={styles.listPane}>
            {jobs.length === 0 ? (
              <p className={componentStyles.empty}>
                No {JOB_FILTERS[filter].toLowerCase()} jobs. {total} job
                {total === 1 ? '' : 's'} in this project.
              </p>
            ) : (
              <JobList
                jobs={jobs}
                selectedId={selected?.id ?? null}
                nounOf={(task) => itemNoun(groupOf(state, task))}
              />
            )}
          </div>
          <div className={styles.detailPane}>
            {selected ? (
              <JobDetail
                state={state}
                task={selected}
                headingId={detailHeadingId}
              />
            ) : (
              <p className={componentStyles.empty}>Select a job.</p>
            )}
          </div>
        </div>
      )}
    </section>
  )
}
