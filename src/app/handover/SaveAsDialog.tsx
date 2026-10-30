import { useMemo, useState } from 'react'
import {
  FieldError,
  Form,
  Input,
  Label,
  Radio,
  RadioGroup,
  Text,
  TextField,
} from 'react-aria-components'
import { useStore } from 'zustand'
import { packageWarnings } from '../../server/handover.ts'
import { projectFileName, type ProjectFile } from '../../server/projectFile.ts'
import {
  useClientSnapshot,
  useServices,
  useUnsavedChanges,
  useWorkbenchSnapshot,
} from '../WorkbenchContext.tsx'
import { ActionButton, useRecordBlocked } from '../components/ActionButton.tsx'
import { HandoverSummary } from '../components/HandoverSummary.tsx'
import { InlineAlert } from '../components/InlineAlert.tsx'
import componentStyles from '../components/components.module.css'
import formStyles from '../components/forms.module.css'
import { downloadText } from '../csv.ts'
import { cx } from '../cx.ts'
import { formatDateTime } from '../format.ts'
import { DialogFrame } from '../shell/HelpDialogs.tsx'
import shellStyles from '../shell/shell.module.css'
import type { SaveAsChoice } from './handoverService.ts'
import { viewerUrl } from './handoverService.ts'
import { ViewsInBrowser } from './ViewsInBrowser.tsx'
import styles from './handover.module.css'

/**
 * File > Save as… (decision 0036; it replaced File > Hand over…): saves the
 * open project as a project, a fully editable and runnable copy kept as a new
 * project in this browser and downloadable as a project file, or as a view, a
 * view-only copy kept in this browser's list of views and downloadable as a
 * view file. Parametric and batch views are deferred.
 */
export function SaveAsDialog() {
  const { handover } = useServices()
  const snapshot = useStore(handover.store)
  const [copying, setCopying] = useState(false)
  const busy = snapshot.busy || copying
  return (
    <DialogFrame
      title="Save as"
      isOpen={snapshot.open}
      onOpenChange={(open) => {
        if (!open) handover.closeDialog()
      }}
      isBusy={busy}
    >
      {snapshot.open ? (
        <>
          <RadioGroup
            className={styles.choices}
            value={snapshot.choice}
            onChange={(value) => handover.setChoice(value as SaveAsChoice)}
            isDisabled={busy}
          >
            <Label className={formStyles.label}>Save this project as</Label>
            <Radio
              value="project"
              className={cx(formStyles.radio, styles.choice)}
            >
              <span>
                <strong>Project</strong>
                <Text slot="description" className={styles.choiceText}>
                  A fully editable, runnable copy, kept as a new project in this
                  browser and downloadable as a project file.
                </Text>
              </span>
            </Radio>
            <Radio value="view" className={cx(formStyles.radio, styles.choice)}>
              <span>
                <strong>View</strong>
                <Text slot="description" className={styles.choiceText}>
                  A view-only copy for the viewer page, kept in this
                  browser&rsquo;s list of views and downloadable as a view file.
                </Text>
              </span>
            </Radio>
          </RadioGroup>
          {snapshot.choice === 'project' ? (
            <ProjectCopy onBusyChange={setCopying} />
          ) : (
            <ViewCopy />
          )}
        </>
      ) : null}
    </DialogFrame>
  )
}

type Copy = { id: string; name: string; file: ProjectFile }

/** Save as > Project: a new project in this browser, through the lifecycle. */
function ProjectCopy({
  onBusyChange,
}: {
  onBusyChange: (busy: boolean) => void
}) {
  const { lifecycle, handover, workbench } = useServices()
  const project = useWorkbenchSnapshot((snapshot) => snapshot.state.project)
  const tasks = useWorkbenchSnapshot((snapshot) => snapshot.state.tasks)
  const drafts = useWorkbenchSnapshot(
    (snapshot) => Object.keys(snapshot.state.pendingEdits).length,
  )
  const unsaved = useUnsavedChanges()
  const pending = useClientSnapshot((snapshot) => snapshot.pending.length > 0)
  const lifecycleBusy = useStore(lifecycle.store, (snapshot) => snapshot.busy)
  const [name, setName] = useState(`${project.name} copy`)
  const [nameError, setNameError] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [copy, setCopy] = useState<Copy | null>(null)
  const recordBlocked = useRecordBlocked()
  const running = Object.values(tasks).filter(
    (task) => task.status === 'queued' || task.status === 'running',
  ).length
  const blocker = saving
    ? 'The copy is being saved.'
    : lifecycleBusy || pending
      ? 'Waiting for the server to answer an earlier request.'
      : null

  const download = (saved: Copy) => {
    const fileName = projectFileName(saved.name, saved.file.savedAt)
    downloadText(fileName, JSON.stringify(saved.file), 'application/json')
    workbench.record({
      type: 'project.downloadFile',
      title: 'Download project file',
      input: { projectId: saved.id },
      summary: `Downloaded the project "${saved.name}" as ${fileName}. Open it from the Projects screen with Open project file….`,
    })
  }

  if (copy) {
    return (
      <>
        <InlineAlert tone="success" live="polite">
          {`"${copy.name}" is a new project in this browser. "${project.name}" stays open; open the copy from here or from Projects.`}
        </InlineAlert>
        <div className={shellStyles.dialogActions}>
          <ActionButton
            label={`Download the project file of ${copy.name}`}
            disabledReason={null}
            onPress={() => download(copy)}
          >
            Download project file
          </ActionButton>
          <ActionButton
            label={`Open the project ${copy.name}`}
            variant="primary"
            disabledReason={blocker}
            onPress={() => {
              handover.closeDialog()
              // Leaving the open project asks first, as every open does.
              void lifecycle.request({ type: 'open', projectId: copy.id })
            }}
          >
            Open the copy
          </ActionButton>
        </div>
      </>
    )
  }

  return (
    <Form
      className={styles.copyForm}
      aria-label="Save as a project"
      onSubmit={(event) => {
        event.preventDefault()
        if (blocker) {
          recordBlocked('Save project copy', blocker)
          return
        }
        setSaving(true)
        onBusyChange(true)
        setError(null)
        void lifecycle
          .saveAs(name)
          .then(({ result, file }) => {
            if (result.outcome.status === 'applied' && file) {
              setCopy({ id: file.project.id, name: file.project.name, file })
              return
            }
            if (result.outcome.status !== 'rejected') return
            const nameIssue = result.outcome.issues.find(
              (issue) => issue.path === 'name',
            )
            if (nameIssue) setNameError(nameIssue.message)
            else
              setError(
                result.outcome.issues.map((issue) => issue.message).join(' '),
              )
          })
          .finally(() => {
            setSaving(false)
            onBusyChange(false)
          })
      }}
    >
      <TextField
        className={formStyles.field}
        value={name}
        isInvalid={Boolean(nameError)}
        maxLength={100}
        autoFocus
        onChange={(value) => {
          setName(value)
          setNameError(null)
        }}
      >
        <Label className={formStyles.label}>Project name</Label>
        <Input className={formStyles.input} />
        <FieldError className={formStyles.fieldError}>{nameError}</FieldError>
      </TextField>
      <ul className={styles.facts}>
        <li>
          {unsaved
            ? 'The copy holds the project as it is now, unsaved changes included; the copy saved of this project stays as it is.'
            : 'The copy holds the project as it is now, with its results, jobs, layouts, and views.'}
        </li>
        {drafts > 0 ? (
          <li>{`${drafts} unsent table draft${drafts === 1 ? ' stays' : 's stay'} here and ${drafts === 1 ? 'is' : 'are'} not copied.`}</li>
        ) : null}
        {running > 0 ? (
          <li>{`${running === 1 ? 'A job is' : `${running} jobs are`} running: in the copy ${running === 1 ? 'it is' : 'they are'} stopped and need${running === 1 ? 's' : ''} a fresh run.`}</li>
        ) : null}
        <li>This project stays open; open the copy when it is saved.</li>
      </ul>
      {error ? <InlineAlert tone="danger">{error}</InlineAlert> : null}
      <div className={shellStyles.dialogActions}>
        <ActionButton
          label="Cancel Save as"
          disabledReason={saving ? 'The copy is being saved.' : null}
          onPress={() => handover.closeDialog()}
        >
          Cancel
        </ActionButton>
        <button
          type="submit"
          className={cx(componentStyles.button, componentStyles.primary)}
          aria-disabled={blocker ? true : undefined}
          title={blocker ?? undefined}
        >
          {saving ? 'Saving…' : 'Save project copy'}
        </button>
      </div>
    </Form>
  )
}

/** Save as > View: a view-only copy of the saved project, for the viewer. */
function ViewCopy() {
  const { handover } = useServices()
  const snapshot = useStore(handover.store)
  const state = useWorkbenchSnapshot((current) => current.state)
  // Re-evaluated when requests start or finish, which can block saving.
  useClientSnapshot((current) => current.pending.length)
  const blocker = snapshot.busy ? null : handover.blocker()
  const drafts = Object.keys(state.pendingEdits).length
  const savedAt = useClientSnapshot((current) => current.meta.savedAt)
  const unsaved = useUnsavedChanges() || drafts > 0
  // With unsaved changes the current model is not what the view holds, so
  // its warnings are shown once the view is made.
  const warnings = useMemo(
    () => (unsaved ? [] : packageWarnings({ model: state })),
    [state, unsaved],
  )
  const done = snapshot.last
  const error = snapshot.issues.map((issue) => issue.message).join(' ')

  if (done) {
    return (
      <>
        {done.storeError ? (
          <InlineAlert tone="warning" title="Not kept in this browser">
            {done.storeError}
          </InlineAlert>
        ) : (
          <InlineAlert tone="success" live="polite">
            {`"${done.package.name}" is in this browser's list of views. The viewer page lists it; download it to give it to someone else.`}
          </InlineAlert>
        )}
        <HandoverSummary
          createdAt={done.package.createdAt}
          provenance={done.package.provenance}
          warnings={packageWarnings(done.package)}
        />
        <div className={shellStyles.dialogActions}>
          <ActionButton
            label={`Download the view file of ${done.package.name}`}
            disabledReason={null}
            onPress={() => handover.download(done.package)}
          >
            Download view file
          </ActionButton>
          {done.storeError ? null : (
            <a
              className={cx(componentStyles.button, componentStyles.primary)}
              href={viewerUrl(done.package.id)}
              target="_blank"
              rel="noopener"
            >
              Open in the viewer
            </a>
          )}
        </div>
        <ViewsInBrowser />
      </>
    )
  }

  return (
    <>
      <ul className={styles.facts}>
        <li>
          A view is a frozen, view-only copy of this project as saved in this
          browser: the published model and its current results, the table
          settings, map layers, and layouts, and where they came from.
        </li>
        <li>
          Left out: held job outputs, job logs, unsent drafts, and changes not
          saved in this browser.
        </li>
        <li>
          Result versions are not kept yet, so a view carries the current
          published results only. Saving several views of a project at once
          (parametric or batch views) is planned.
        </li>
      </ul>
      {warnings.length > 0 ? (
        <InlineAlert tone="warning" title="The view will warn">
          <ul className={styles.facts}>
            {warnings.map((warning) => (
              <li key={warning}>{warning}</li>
            ))}
          </ul>
        </InlineAlert>
      ) : null}
      {savedAt && unsaved && !blocker ? (
        <InlineAlert tone="warning" title="Unsaved changes stay out">
          {`The view holds the copy saved ${formatDateTime(savedAt)}${drafts > 0 ? `; ${drafts} unsent draft${drafts === 1 ? '' : 's'} here and` : ';'} changes made since are not in it. Save first (File > Save, Ctrl+S) to include them.`}
        </InlineAlert>
      ) : null}
      {blocker && !error ? (
        <InlineAlert tone="info">{blocker}</InlineAlert>
      ) : null}
      {error ? <InlineAlert tone="danger">{error}</InlineAlert> : null}
      <div className={shellStyles.dialogActions}>
        <ActionButton
          label="Cancel Save as"
          disabledReason={snapshot.busy ? 'The view is being saved.' : null}
          onPress={() => handover.closeDialog()}
        >
          Cancel
        </ActionButton>
        <ActionButton
          label="Save as a view"
          variant="primary"
          disabledReason={snapshot.busy ? 'The view is being saved.' : blocker}
          onPress={() => void handover.handOver()}
        >
          {snapshot.busy ? 'Saving…' : 'Save view'}
        </ActionButton>
      </div>
      <ViewsInBrowser />
    </>
  )
}
