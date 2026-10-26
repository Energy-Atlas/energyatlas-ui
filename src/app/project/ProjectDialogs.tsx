import { useState } from 'react'
import {
  Button,
  FieldError,
  Form,
  Input,
  Label,
  TextField,
} from 'react-aria-components'
import { useStore } from 'zustand'
import {
  useClientSnapshot,
  useServices,
  useWorkbenchSnapshot,
} from '../WorkbenchContext.tsx'
import { ActionButton } from '../components/ActionButton.tsx'
import componentStyles from '../components/components.module.css'
import formStyles from '../components/forms.module.css'
import { cx } from '../cx.ts'
import { DialogFrame } from '../shell/HelpDialogs.tsx'
import { DemoConditionsDialog } from '../shell/DemoConditionsDialog.tsx'
import { ProjectList } from './ProjectList.tsx'
import styles from './project.module.css'

export function ProjectDialogs() {
  const [conditionsOpen, setConditionsOpen] = useState(false)
  return (
    <>
      <ProjectDialogsContent onOpenConditions={() => setConditionsOpen(true)} />
      <DemoConditionsDialog
        isOpen={conditionsOpen}
        onOpenChange={setConditionsOpen}
      />
    </>
  )
}

function ProjectDialogsContent({
  onOpenConditions,
}: {
  onOpenConditions: () => void
}) {
  const { lifecycle, client } = useServices()
  const snapshot = useStore(lifecycle.store, (current) => current)
  const meta = useClientSnapshot((current) => current.meta)
  const pending = useClientSnapshot((current) => current.pending.length > 0)
  const transitioning = useClientSnapshot((current) => current.transitioning)
  const state = useWorkbenchSnapshot((current) => current.state)
  const [name, setName] = useState('')
  const nameError = snapshot.issues.find(
    (issue) => issue.path === 'name',
  )?.message
  const error = snapshot.issues
    .filter((issue) => issue.path !== 'name')
    .map((issue) => issue.message)
    .join(' ')
  const jobs = Object.values(state.tasks).filter(
    (task) => task.status === 'queued' || task.status === 'running',
  )
  const drafts = Object.keys(state.pendingEdits).length
  const saveOnly = snapshot.guard?.type === 'save'
  const busy = snapshot.busy || pending

  if (snapshot.guard)
    return (
      <DialogFrame
        title={saveOnly ? 'Save pending edits?' : 'Leave this project?'}
        role="alertdialog"
        isBusy={busy}
        isOpen
        onOpenChange={(open) => {
          if (!open) lifecycle.stay()
        }}
      >
        <p>
          {saveOnly
            ? 'The table has unsent edits. Choose whether to apply them before saving.'
            : `You are leaving “${state.project.name}”.`}
        </p>
        {!saveOnly && jobs.length ? (
          <p>
            {jobs.length} active job(s) will be cancelled if you continue. Stay
            keeps them running.
          </p>
        ) : null}
        {!saveOnly && (meta.dirty || drafts) ? (
          <p>
            {drafts ? `${drafts} unsent table edit(s) and ` : ''}Unsaved changes
            will be lost unless you save. The saved copy is unchanged if you
            discard.
          </p>
        ) : null}
        {error ? (
          <p role="alert" className={formStyles.alert}>
            {error}
          </p>
        ) : null}
        {busy ? (
          <>
            <p role="status">Waiting for the server…</p>
            <Button
              className={componentStyles.button}
              onPress={onOpenConditions}
            >
              Change demo conditions
            </Button>
          </>
        ) : null}
        <div className={styles.actions}>
          <Button
            className={componentStyles.button}
            isDisabled={busy}
            onPress={() => lifecycle.stay()}
          >
            {saveOnly ? 'Cancel' : 'Stay'}
          </Button>
          <Button
            className={componentStyles.button}
            isDisabled={busy}
            onPress={() =>
              void lifecycle.confirm(saveOnly ? 'appliedOnly' : 'discard')
            }
          >
            {saveOnly ? 'Save applied changes only' : 'Discard and leave'}
          </Button>
          <ActionButton
            label={
              drafts
                ? saveOnly
                  ? 'Apply and save'
                  : 'Apply, save and leave'
                : 'Save and leave'
            }
            variant="primary"
            disabledReason={
              busy
                ? 'Waiting for the server.'
                : saveOnly && jobs.length
                  ? 'A run holds the edit lock. Cancel it in Jobs before applying drafts, or save applied changes only.'
                  : null
            }
            onPress={() => void lifecycle.confirm('save')}
          >
            {drafts
              ? saveOnly
                ? 'Apply and save'
                : 'Apply, save and leave'
              : 'Save and leave'}
          </ActionButton>
        </div>
      </DialogFrame>
    )

  if (transitioning && snapshot.dialog === null)
    return (
      <DialogFrame
        title="Changing project"
        role="alertdialog"
        isOpen
        isBusy
        onOpenChange={() => undefined}
      >
        <p role="status">
          Waiting for the server. Project controls are locked until this change
          finishes.
        </p>
        <Button className={componentStyles.button} onPress={onOpenConditions}>
          Change demo conditions
        </Button>
      </DialogFrame>
    )

  return (
    <>
      <DialogFrame
        title="Create project"
        isBusy={busy}
        isOpen={snapshot.dialog === 'create'}
        onOpenChange={(open) => {
          if (!open) lifecycle.closeDialog()
        }}
      >
        <p>
          Create an empty synthetic workflow. Save it to keep it in this
          browser.
        </p>
        <Form
          className={formStyles.form}
          validationBehavior="aria"
          onSubmit={(event) => {
            event.preventDefault()
            if (!busy)
              void lifecycle
                .request({ type: 'create', name })
                .then((result) => {
                  if (result.outcome.status === 'applied') setName('')
                })
          }}
        >
          <TextField
            className={formStyles.field}
            isInvalid={Boolean(nameError)}
            isDisabled={busy}
          >
            <Label className={formStyles.label}>Project name</Label>
            <Input
              className={formStyles.input}
              value={name}
              onChange={(event) => {
                setName(event.target.value)
                lifecycle.clearIssue('name')
              }}
              maxLength={100}
              autoFocus
            />
            <FieldError className={formStyles.fieldError}>
              {nameError}
            </FieldError>
          </TextField>
          {error ? (
            <p role="alert" className={formStyles.alert}>
              {error}
            </p>
          ) : null}
          <div className={styles.actions}>
            <Button
              className={componentStyles.button}
              isDisabled={busy}
              onPress={() => lifecycle.closeDialog()}
            >
              Cancel
            </Button>
            <Button
              className={cx(componentStyles.button, componentStyles.primary)}
              type="submit"
              isDisabled={busy}
            >
              {busy ? 'Creating…' : 'Create project'}
            </Button>
          </div>
          {busy ? (
            <>
              <p role="status">Creating project. Waiting for the server…</p>
              <Button
                className={componentStyles.button}
                onPress={onOpenConditions}
              >
                Change demo conditions
              </Button>
            </>
          ) : null}
        </Form>
      </DialogFrame>
      <DialogFrame
        title="Open project"
        isBusy={busy}
        isOpen={snapshot.dialog === 'open'}
        onOpenChange={(open) => {
          if (!open) lifecycle.closeDialog()
        }}
      >
        <p>
          Saved synthetic projects in this browser. No filesystem picker is
          connected.
        </p>
        {error || meta.catalogError ? (
          <p role="alert" className={formStyles.alert}>
            {error || meta.catalogError}
          </p>
        ) : null}
        {pending ? (
          <p role="status">Loading projects…</p>
        ) : meta.projects.length ? (
          <ProjectList projects={meta.projects} disabled={busy} />
        ) : (
          <p>No saved projects yet.</p>
        )}
        <div className={styles.actions}>
          {busy ? (
            <Button
              className={componentStyles.button}
              onPress={onOpenConditions}
            >
              Change demo conditions
            </Button>
          ) : null}
          <Button
            className={componentStyles.button}
            isDisabled={busy}
            onPress={() => lifecycle.closeDialog()}
          >
            Cancel
          </Button>
          <Button
            className={componentStyles.button}
            isDisabled={busy}
            onPress={() => void client.listProjects()}
          >
            Refresh projects
          </Button>
        </div>
      </DialogFrame>
    </>
  )
}
