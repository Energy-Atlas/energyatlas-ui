import { useId } from 'react'
import {
  discardNote,
  groupOf,
  openFailedAttempt,
  retryBlocker,
  retryScope,
} from '../../domain/jobs/runGroups.ts'
import { stageSubmitBlocker } from '../../domain/commands.ts'
import { STAGE_IDS, hasActiveTask } from '../../domain/workflow.ts'
import {
  useClientSnapshot,
  useServices,
  useStageStates,
  useWorkbenchSnapshot,
} from '../WorkbenchContext.tsx'
import { ActionButton } from '../components/ActionButton.tsx'
import { CapabilityBadge } from '../components/CapabilityBadge.tsx'
import { StateBadge } from '../components/StateBadge.tsx'
import { cx } from '../cx.ts'
import { forStage, waitingReason } from '../service/usePendingReason.ts'
import styles from './panels.module.css'

/** Compact workflow view (decision 0003): the same state as the Roadmap page. */
export function WorkflowPanel() {
  const headingId = useId()
  const { workbench, client, layout } = useServices()
  const pending = useClientSnapshot((snapshot) => snapshot.pending)
  const workflow = useWorkbenchSnapshot((snapshot) => snapshot.state.workflow)
  const tasks = useWorkbenchSnapshot((snapshot) => snapshot.state.tasks)
  const project = useWorkbenchSnapshot((snapshot) => snapshot.state)
  const states = useStageStates()

  return (
    <section className={styles.panel} aria-labelledby={headingId}>
      <header className={styles.panelHeader}>
        <h2 id={headingId}>Workflow</h2>
        <CapabilityBadge id="workflow.stageRuns" />
      </header>
      <ol className={styles.stageList}>
        {workflow.stageIds.map((stageId, index) => {
          const stage = workflow.stages[stageId]
          if (!stage) return null
          const state = states[stageId] ?? 'future'
          const isCurrent = workflow.currentStageId === stageId
          const hasRun = stage.lastRun !== null
          const running = hasActiveTask(tasks, stageId)
          return (
            <li
              key={stageId}
              className={cx(styles.stage, isCurrent && styles.current)}
              aria-current={isCurrent ? 'step' : undefined}
            >
              <div className={styles.stageRow}>
                <button
                  type="button"
                  className={styles.stageName}
                  onClick={() =>
                    workbench.execute({
                      type: 'workflow.setCurrentStage',
                      input: { stageId },
                    })
                  }
                >
                  <span className={styles.stageNumber}>{index + 1}</span>
                  {stage.name}
                </button>
                <StateBadge state={state} />
              </div>
              <div className={styles.stageActions}>
                <ActionButton
                  label={`${hasRun ? 'Rerun' : 'Run'} ${stage.name}${discardNote(project, stageId)}`}
                  disabledReason={
                    waitingReason(
                      pending,
                      'workflow.runStage',
                      'the run was requested',
                      forStage(stageId),
                    ) ?? stageSubmitBlocker(project, stageId)
                  }
                  onPress={() =>
                    void client.execute({
                      type: 'workflow.runStage',
                      input: { stageId },
                    })
                  }
                >
                  {hasRun ? 'Rerun' : 'Run'}
                </ActionButton>
                {(() => {
                  const failed = openFailedAttempt(project, stageId)
                  const group = failed ? groupOf(project, failed) : null
                  if (!failed || !group) return null
                  return (
                    <ActionButton
                      label={`${retryScope(group)} of ${stage.name}`}
                      disabledReason={
                        waitingReason(
                          pending,
                          'job.retry',
                          'the retry was requested',
                        ) ?? retryBlocker(project, failed.id)
                      }
                      onPress={() =>
                        void client.execute({
                          type: 'job.retry',
                          input: { taskId: failed.id },
                        })
                      }
                    >
                      Retry
                    </ActionButton>
                  )
                })()}
                {stageId === STAGE_IDS.archetypes ? (
                  <ActionButton
                    label="Open Archetypes to edit definitions and schedules"
                    disabledReason={null}
                    onPress={() => layout.openPage('archetypes')}
                  >
                    Archetypes
                  </ActionButton>
                ) : null}
                {stageId === STAGE_IDS.schema ? (
                  <ActionButton
                    label="Open Data intake to map and fuse a dataset"
                    disabledReason={null}
                    onPress={() => layout.openPage('intake')}
                  >
                    Data intake
                  </ActionButton>
                ) : null}
                {stage.skippable ? (
                  <ActionButton
                    label={`${stage.skipped ? 'Restore' : 'Skip'} ${stage.name}`}
                    disabledReason={
                      running
                        ? `"${stage.name}" is running.`
                        : waitingReason(
                            pending,
                            'workflow.setStageSkipped',
                            stage.skipped
                              ? 'the stage is being restored'
                              : 'the stage is being skipped',
                            forStage(stageId),
                          )
                    }
                    onPress={() =>
                      void client.execute({
                        type: 'workflow.setStageSkipped',
                        input: { stageId, skipped: !stage.skipped },
                      })
                    }
                  >
                    {stage.skipped ? 'Restore' : 'Skip'}
                  </ActionButton>
                ) : null}
              </div>
              {stage.lastRun?.message ? (
                <p className={styles.runMessage}>{stage.lastRun.message}</p>
              ) : null}
            </li>
          )
        })}
      </ol>
    </section>
  )
}
