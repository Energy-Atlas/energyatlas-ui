import { useState } from 'react'
import {
  Button,
  FieldError,
  Form,
  Input,
  Label,
  TextField,
} from 'react-aria-components'
import { stageSubmitBlocker } from '../../domain/commands.ts'
import {
  downstreamIds,
  hasActiveTask,
  upstreamIds,
} from '../../domain/workflow.ts'
import {
  useClientSnapshot,
  useServices,
  useStageStates,
  useWorkbenchSnapshot,
} from '../WorkbenchContext.tsx'
import { splitIssues } from '../commandErrors.ts'
import { ActionButton } from '../components/ActionButton.tsx'
import { InlineAlert } from '../components/InlineAlert.tsx'
import { PropertyList } from '../components/PropertyList.tsx'
import { StateBadge } from '../components/StateBadge.tsx'
import componentStyles from '../components/components.module.css'
import formStyles from '../components/forms.module.css'
import { forStage, waitingReason } from '../service/usePendingReason.ts'
import styles from './properties.module.css'

/**
 * A workflow stage in Properties (decision 0028), as chosen on the Roadmap:
 * what it does, what it depends on and feeds, its last run, Run or Rerun,
 * Skip or Restore, moving to the previous or next stage, and inserting a
 * custom stage after it. Replaces the Roadmap's own details panel.
 */
export function StageProperties({ stageId }: { stageId: string }) {
  const { workbench, client } = useServices()
  const pending = useClientSnapshot((snapshot) => snapshot.pending)
  const state = useWorkbenchSnapshot((snapshot) => snapshot.state)
  const states = useStageStates()
  const { workflow, tasks } = state
  const stage = workflow.stages[stageId]
  if (!stage) return null

  const index = workflow.stageIds.indexOf(stageId)
  const previousId = workflow.stageIds[index - 1]
  const nextId = workflow.stageIds[index + 1]
  const names = (ids: string[]) =>
    ids.map((id) => workflow.stages[id]?.name ?? id).join(', ') || 'None'
  const hasRun = stage.lastRun !== null
  // Moving to another stage focuses it and shows it here.
  const show = (id: string) => {
    workbench.execute({
      type: 'workflow.setCurrentStage',
      input: { stageId: id },
    })
    workbench.execute({
      type: 'selection.set',
      input: { entityType: 'stage', ids: [id] },
    })
  }

  return (
    <section className={styles.definition} aria-label={`Stage ${stage.name}`}>
      <header className={styles.header}>
        <p className={styles.eyebrow}>Stage {index + 1}</p>
        <div className={styles.titleRow}>
          <h3 className={styles.title}>{stage.name}</h3>
          <StateBadge state={states[stageId] ?? 'future'} />
        </div>
        <p className={styles.provenance}>{stage.description}</p>
      </header>
      <PropertyList
        items={[
          { label: 'Depends on', value: names(upstreamIds(workflow, stageId)) },
          { label: 'Feeds', value: names(downstreamIds(workflow, stageId)) },
          {
            label: 'Last run',
            value: stage.lastRun?.message ?? 'Not run yet.',
          },
        ]}
      />
      <div className={styles.actions}>
        <ActionButton
          label={`${hasRun ? 'Rerun' : 'Run'} ${stage.name}`}
          variant="primary"
          disabledReason={
            waitingReason(
              pending,
              'workflow.runStage',
              'the run was requested',
              forStage(stageId),
            ) ?? stageSubmitBlocker(state, stageId)
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
              hasActiveTask(tasks, stageId)
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
      <div className={styles.actions}>
        <ActionButton
          label="Previous stage"
          disabledReason={previousId ? null : 'This is the first stage.'}
          onPress={() => {
            if (previousId) show(previousId)
          }}
        >
          Previous
        </ActionButton>
        <ActionButton
          label="Next stage"
          disabledReason={nextId ? null : 'This is the last stage.'}
          onPress={() => {
            if (nextId) show(nextId)
          }}
        >
          Next
        </ActionButton>
      </div>
      <InsertStageForm afterStageId={stageId} key={stageId} />
    </section>
  )
}

function InsertStageForm({ afterStageId }: { afterStageId: string }) {
  const { client } = useServices()
  const [sending, setSending] = useState(false)
  const [name, setName] = useState('')
  const [nameError, setNameError] = useState<string | null>(null)
  const [general, setGeneral] = useState<string | null>(null)

  return (
    <Form
      className={styles.insertForm}
      validationBehavior="aria"
      onSubmit={(event) => {
        event.preventDefault()
        if (sending) return
        setSending(true)
        void client
          .execute({
            type: 'workflow.insertStage',
            input: { afterStageId, name },
          })
          .then((result) => {
            setSending(false)
            if (result.outcome.status === 'applied') {
              setName('')
              setNameError(null)
              setGeneral(null)
              return
            }
            const split = splitIssues(result.outcome.issues)
            setNameError(split.fieldErrors.name ?? null)
            setGeneral(
              [split.general, split.fieldErrors.afterStageId]
                .filter(Boolean)
                .join(' ') || null,
            )
          })
      }}
    >
      <TextField
        name="name"
        className={formStyles.field}
        value={name}
        isInvalid={nameError !== null}
        onChange={(value) => {
          setName(value)
          setNameError(null)
        }}
      >
        <Label className={formStyles.label}>
          Insert a custom stage after this one
        </Label>
        <Input className={formStyles.input} />
        <FieldError className={formStyles.fieldError}>{nameError}</FieldError>
      </TextField>
      {general ? <InlineAlert tone="danger">{general}</InlineAlert> : null}
      <Button
        type="submit"
        className={componentStyles.button}
        isPending={sending}
      >
        {sending ? 'Sending…' : 'Insert stage'}
      </Button>
    </Form>
  )
}
