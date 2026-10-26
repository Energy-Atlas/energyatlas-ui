import { useId } from 'react'
import { hasActiveTask, stageRunBlocker } from '../../domain/workflow.ts'
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
  const { workbench, client } = useServices()
  const pending = useClientSnapshot((snapshot) => snapshot.pending)
  const workflow = useWorkbenchSnapshot((snapshot) => snapshot.state.workflow)
  const tasks = useWorkbenchSnapshot((snapshot) => snapshot.state.tasks)
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
                  label={`${hasRun ? 'Rerun' : 'Run'} ${stage.name}`}
                  disabledReason={
                    waitingReason(
                      pending,
                      'workflow.runStage',
                      'the run was requested',
                      forStage(stageId),
                    ) ?? stageRunBlocker(workflow, tasks, stageId)
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
