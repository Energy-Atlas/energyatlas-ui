import { ProgressBar } from 'react-aria-components'
import {
  discardNote,
  groupOf,
  itemCounts,
  itemNoun,
  signatureMismatch,
} from '../../../domain/jobs/runGroups.ts'
import type { Task, WorkbenchState } from '../../../domain/types.ts'
import { useClientSnapshot, useServices } from '../../WorkbenchContext.tsx'
import { ActionButton } from '../../components/ActionButton.tsx'
import componentStyles from '../../components/components.module.css'
import { InlineAlert } from '../../components/InlineAlert.tsx'
import { PropertyList } from '../../components/PropertyList.tsx'
import { cx } from '../../cx.ts'
import { formatTime } from '../../format.ts'
import { JobItems } from './JobItems.tsx'
import { JobLog } from './JobLog.tsx'
import { freshRunAndSelect, retryAndSelect } from './jobActions.ts'
import { JobStatusBadge } from './JobStatusBadge.tsx'
import {
  JOB_STATUS_LABELS,
  attemptsOf,
  cancelBlocker,
  freshRunBlocker,
  publicationLabel,
  retryActionBlocker,
  retryLabel,
} from './jobView.ts'
import styles from './jobs.module.css'

/** The selected job: summary, scoped progress, actions, attempts, failed items, and log. */
export function JobDetail({
  state,
  task,
  headingId,
}: {
  state: WorkbenchState
  task: Task
  headingId: string
}) {
  const services = useServices()
  const { client, view } = services
  const pending = useClientSnapshot((snapshot) => snapshot.pending)
  const group = groupOf(state, task)
  const counts = itemCounts(task)
  const attempts = attemptsOf(state, task)
  const publication = publicationLabel(task, group)
  const changed =
    group && group.status === 'open' ? signatureMismatch(state, group) : null
  const stageName = state.workflow.stages[task.stageId]?.name ?? task.stageId

  return (
    <article className={styles.detail} aria-labelledby={headingId}>
      <header className={styles.detailHeader}>
        <h3 id={headingId}>
          {task.label}{' '}
          <span className={componentStyles.muted}>
            · attempt {task.attempt}
          </span>
        </h3>
        <JobStatusBadge status={task.status} />
      </header>

      <div className={styles.actions} role="group" aria-label="Job actions">
        <ActionButton
          label={`Cancel ${task.label}`}
          disabledReason={cancelBlocker(task, pending)}
          onPress={() =>
            void client.execute({
              type: 'task.cancel',
              input: { taskId: task.id },
            })
          }
        >
          Cancel
        </ActionButton>
        <ActionButton
          label={`${retryLabel(state, task)} of ${task.label}`}
          disabledReason={retryActionBlocker(state, task, pending)}
          variant="primary"
          onPress={() => void retryAndSelect(services, task.id)}
        >
          {retryLabel(state, task)}
        </ActionButton>
        <ActionButton
          label={`Fresh run of ${stageName}${discardNote(state, task.stageId)}`}
          disabledReason={freshRunBlocker(state, task, pending)}
          onPress={() => void freshRunAndSelect(services, task.stageId)}
        >
          Fresh run
        </ActionButton>
      </div>

      {task.message ? (
        <InlineAlert
          tone={
            task.status === 'failed'
              ? 'danger'
              : task.status === 'invalidated' || task.status === 'cancelled'
                ? 'warning'
                : 'info'
          }
          // The job's state, present whenever it is shown; the failure itself
          // was announced as a message when it happened.
          live="off"
          className={styles.message}
        >
          {task.message}
        </InlineAlert>
      ) : null}

      <ProgressBar
        className={styles.progress}
        aria-label={`${task.label} progress`}
        value={task.progress * 100}
      >
        {({ percentage, valueText }) => (
          <>
            <span className={styles.progressTrack}>
              <span
                className={styles.progressFill}
                style={{ width: `${percentage ?? 0}%` }}
              />
            </span>
            <span className={styles.progressText}>{valueText}</span>
          </>
        )}
      </ProgressBar>

      <PropertyList
        items={[
          { label: 'Stage', value: stageName },
          { label: 'Started by', value: task.source },
          {
            label: 'Queued',
            value: (
              <time dateTime={task.createdAt}>
                {formatTime(task.createdAt)}
              </time>
            ),
          },
          {
            label: 'Updated',
            value: (
              <time dateTime={task.updatedAt}>
                {formatTime(task.updatedAt)}
              </time>
            ),
          },
          counts && {
            label: group?.kind === 'fusion' ? 'Records' : 'Items',
            value:
              counts.total === 0
                ? 'Publication only'
                : [
                    `${counts.succeeded} succeeded`,
                    `${counts.failed} failed`,
                    counts.pending > 0 ? `${counts.pending} pending` : null,
                    counts.unprocessed > 0
                      ? `${counts.unprocessed} ${task.status === 'cancelled' ? 'cancelled' : 'not processed'}`
                      : null,
                    `of ${counts.total}`,
                  ]
                    .filter(Boolean)
                    .join(', '),
          },
          publication ? { label: 'Results', value: publication } : null,
          group && {
            label: 'Inputs',
            value: changed
              ? `Changed since submission: ${changed}. A retry is not possible; start a fresh run.`
              : group.status === 'open'
                ? 'Unchanged since submission.'
                : `Captured at submission (${group.signature.membership.length || 'whole-stage'}${group.signature.membership.length ? ` ${itemNoun(group)}` : ''}).`,
          },
        ]}
      />

      {attempts.length > 1 ? (
        <section aria-label="Attempts" className={styles.section}>
          <h4>Attempts of this run</h4>
          <ol className={styles.attempts}>
            {attempts.map((attempt) => (
              <li key={attempt.id}>
                <button
                  type="button"
                  className={cx(
                    styles.attempt,
                    attempt.id === task.id && styles.attemptCurrent,
                  )}
                  aria-current={attempt.id === task.id ? 'true' : undefined}
                  onClick={() =>
                    view.execute({
                      type: 'jobs.select',
                      input: { taskId: attempt.id },
                    })
                  }
                >
                  Attempt {attempt.attempt}: {JOB_STATUS_LABELS[attempt.status]}
                  {attempt.items
                    ? `, ${attempt.items.ids.length} ${itemNoun(group, attempt.items.ids.length)}`
                    : ''}
                </button>
              </li>
            ))}
          </ol>
        </section>
      ) : null}

      <JobItems key={task.id} task={task} state={state} />

      <section aria-label="Log" className={styles.section}>
        <h4>Log ({task.log.length})</h4>
        <JobLog task={task} />
      </section>
    </article>
  )
}
