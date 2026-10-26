import { useId } from 'react'
import { Label, Radio, RadioGroup } from 'react-aria-components'
import {
  useServices,
  useViewState,
  useWorkbenchSnapshot,
} from '../../WorkbenchContext.tsx'
import { CapabilityBadge } from '../../components/CapabilityBadge.tsx'
import componentStyles from '../../components/components.module.css'
import formStyles from '../../components/forms.module.css'
import { JOB_FILTERS, type JobFilter } from '../../view/viewOperations.ts'
import { groupOf, itemNoun } from '../../../domain/jobs/runGroups.ts'
import { JobDetail } from './JobDetail.tsx'
import { JobList } from './JobList.tsx'
import { listJobs, shownJob } from './jobView.ts'
import styles from './jobs.module.css'

function isJobFilter(value: string): value is JobFilter {
  return value in JOB_FILTERS
}

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
      <header className={styles.header}>
        <h2 id={headingId}>Jobs</h2>
        <CapabilityBadge id="workflow.stageRuns" />
        <RadioGroup
          className={styles.filter}
          orientation="horizontal"
          value={filter}
          onChange={(value) => {
            if (isJobFilter(value)) {
              view.execute({ type: 'jobs.setFilter', input: { filter: value } })
            }
          }}
        >
          <Label className="visually-hidden">Show jobs</Label>
          {(Object.keys(JOB_FILTERS) as JobFilter[]).map((value) => (
            <Radio key={value} value={value} className={formStyles.radio}>
              {JOB_FILTERS[value]}
            </Radio>
          ))}
        </RadioGroup>
      </header>
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
