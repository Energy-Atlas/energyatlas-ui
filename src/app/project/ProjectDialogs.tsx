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
  useUnsavedChanges,
} from '../WorkbenchContext.tsx'
import componentStyles from '../components/components.module.css'
import { ConfirmDialog } from '../components/ConfirmDialog.tsx'
import formStyles from '../components/forms.module.css'
import { InlineAlert } from '../components/InlineAlert.tsx'
import { cx } from '../cx.ts'
import { DialogFrame } from '../shell/HelpDialogs.tsx'
import { openDemoPanel } from '../shell/demoSwitchStore.ts'
import { ProjectList } from './ProjectList.tsx'
import styles from './project.module.css'

export function ProjectDialogs() {
  // Demo conditions open in the floating demo switch (decision 0028).
  return <ProjectDialogsContent onOpenConditions={openDemoPanel} />
}

function ProjectDialogsContent({
  onOpenConditions,
}: {
  onOpenConditions: () => void
}) {
  const { lifecycle, client } = useServices()
  const snapshot = useStore(lifecycle.store, (current) => current)
  const meta = useClientSnapshot((current) => current.meta)
  const unsaved = useUnsavedChanges()
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

  // Leaving with unsaved work or active jobs asks in the shared confirmation
  // (decision 0036): Enter saves, Esc stays.
  const failed = (
    result: Awaited<ReturnType<typeof lifecycle.confirm>>,
  ): string | null =>
    result && result.outcome.status === 'rejected'
      ? result.outcome.issues.map((issue) => issue.message).join(' ') ||
        'The change was refused.'
      : null
  if (snapshot.guard)
    return (
      <ConfirmDialog
        title={saveOnly ? 'Save pending edits?' : 'Leave this project?'}
        isOpen
        onOpenChange={(open) => {
          if (!open) lifecycle.stay()
        }}
        isBusy={busy}
        busyText="Waiting for the server…"
        cancelLabel={saveOnly ? 'Cancel' : 'Stay'}
        secondary={{
          label: saveOnly ? 'Save applied changes only' : 'Discard and leave',
          onPress: async () =>
            failed(
              await lifecycle.confirm(saveOnly ? 'appliedOnly' : 'discard'),
            ),
        }}
        confirm={{
          label: drafts
            ? saveOnly
              ? 'Apply and save'
              : 'Apply, save and leave'
            : 'Save and leave',
          disabledReason:
            saveOnly && jobs.length
              ? 'A run holds the edit lock. Cancel it in Jobs before applying drafts, or save applied changes only.'
              : null,
          onPress: async () => failed(await lifecycle.confirm('save')),
        }}
        extra={
          busy ? (
            <Button
              className={componentStyles.button}
              onPress={onOpenConditions}
            >
              Change demo conditions
            </Button>
          ) : null
        }
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
        {!saveOnly && (unsaved || drafts) ? (
          <p>
            {drafts ? `${drafts} unsent table edit(s) and ` : ''}Unsaved changes
            will be lost unless you save. The saved copy is unchanged if you
            discard.
          </p>
        ) : null}
      </ConfirmDialog>
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
          {error ? <InlineAlert tone="danger">{error}</InlineAlert> : null}
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
          <InlineAlert tone="danger">{error || meta.catalogError}</InlineAlert>
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
