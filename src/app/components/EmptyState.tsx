import { Info } from 'lucide-react'
import { stageSubmitBlocker } from '../../domain/commands.ts'
import { useServices, useWorkbenchSnapshot } from '../WorkbenchContext.tsx'
import { forStage, usePendingReason } from '../service/usePendingReason.ts'
import { ActionButton } from './ActionButton.tsx'
import styles from './components.module.css'

type EmptyStateProps = {
  title: string
  message: string
  /** The stage that produces the missing data, offered as the next step. */
  stageId: string
}

export function EmptyState({ title, message, stageId }: EmptyStateProps) {
  const { client, layout } = useServices()
  const waiting = usePendingReason(
    'workflow.runStage',
    'the run was requested',
    forStage(stageId),
  )
  const state = useWorkbenchSnapshot((snapshot) => snapshot.state)
  const stage = state.workflow.stages[stageId]

  return (
    <div className={styles.emptyState}>
      <p className={styles.emptyTitle}>
        <Info size={16} aria-hidden="true" /> {title}
      </p>
      <p className={styles.muted}>{message}</p>
      <div className={styles.emptyActions}>
        {stage ? (
          <ActionButton
            label={`Run ${stage.name}`}
            variant="primary"
            disabledReason={waiting ?? stageSubmitBlocker(state, stageId)}
            onPress={() =>
              void client.execute({
                type: 'workflow.runStage',
                input: { stageId },
              })
            }
          >
            Run {stage.name}
          </ActionButton>
        ) : null}
        <ActionButton
          label="Show the Workflow panel"
          disabledReason={
            layout.isPanelOpen('workflow')
              ? 'The Workflow panel is already open.'
              : null
          }
          onPress={() => layout.togglePanel('workflow')}
        >
          Show Workflow
        </ActionButton>
      </div>
    </div>
  )
}
