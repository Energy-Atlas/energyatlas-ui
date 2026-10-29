import { MoreHorizontal } from 'lucide-react'
import { useId, useLayoutEffect, useRef, useState } from 'react'
import {
  Button,
  Checkbox,
  FieldError,
  Form,
  Input,
  Label,
  TextField,
} from 'react-aria-components'
import { useStore } from 'zustand'
import {
  useLayoutVersion,
  useServices,
  useViewState,
} from '../WorkbenchContext.tsx'
import { ActionButton, useRecordBlocked } from '../components/ActionButton.tsx'
import componentStyles from '../components/components.module.css'
import formStyles from '../components/forms.module.css'
import { InlineAlert } from '../components/InlineAlert.tsx'
import { MenuButton } from '../components/MenuButton.tsx'
import { HeaderCount, PanelHeader } from '../components/PanelHeader.tsx'
import { WorkbenchTable } from '../components/WorkbenchTable.tsx'
import { cx } from '../cx.ts'
import { formatCount, formatDateTime } from '../format.ts'
import shellStyles from '../shell/shell.module.css'
import type { DataColumn } from '../tables/tableModel.ts'
import type { LayoutLibrary, LayoutOutcome } from './layoutLibrary.ts'
import { layoutsPanelStore } from './layoutsPanelStore.ts'
import { MAX_LAYOUT_NAME, type SavedLayout } from './savedLayout.ts'
import styles from './layouts.module.css'

const SOURCE_LABELS = {
  manual: 'A person',
  agent: 'The agent',
  system: 'The system',
} as const

export function issueOf(outcome: LayoutOutcome, path: string): string | null {
  if (outcome.status !== 'rejected') return null
  return outcome.issues.find((issue) => issue.path === path)?.message ?? null
}

/**
 * Saved layouts (decisions 0032 and 0033), kept with the project: save the
 * current panels and views under a name, and apply, update, rename,
 * duplicate, delete, or choose the default from the table of layouts. On the
 * viewer page the handed-over layouts can only be applied, so saving and the
 * changing actions are left out. Results go to the status bar and Messages
 * like any operation.
 */
export function LayoutsPanel() {
  const headingId = useId()
  const { layouts } = useServices()
  const library = useStore(layouts.store)
  const focusId = useStore(layoutsPanelStore, (state) => state.focusId)
  const [pending, setPending] = useState<{
    mode: 'rename' | 'delete'
    id: string
  } | null>(null)
  const pendingLayout = pending ? layouts.find(pending.id) : null
  const { writable } = layouts
  const count = library.project.layouts.length
  const panelRef = useRef<HTMLElement>(null)
  // The row whose actions menu takes focus back once a rename or delete
  // closes, so focus never drops to the page (else the row, else the table).
  const returnFocus = useRef<string | null>(null)
  useLayoutEffect(() => {
    const id = returnFocus.current
    const panel = panelRef.current
    if (pending !== null || id === null || !panel) return
    returnFocus.current = null
    const actions = [
      ...panel.querySelectorAll<HTMLElement>('[data-layout-actions]'),
    ].find((each) => each.dataset.layoutActions === id)
    const target =
      actions?.querySelector<HTMLElement>('button[aria-haspopup]') ??
      actions?.closest<HTMLElement>('[role="row"]') ??
      panel.querySelector<HTMLElement>('[role="grid"]') ??
      panel.querySelector<HTMLElement>('input')
    target?.focus()
  }, [pending])
  const close = (id: string) => {
    returnFocus.current = id
    setPending(null)
  }

  return (
    <section
      ref={panelRef}
      className={styles.panel}
      aria-labelledby={headingId}
    >
      <PanelHeader
        title="Layouts"
        headingId={headingId}
        meta={<HeaderCount>{formatCount(count, 'layout')}</HeaderCount>}
        description={
          writable
            ? 'Saved with this project when you save it, and handed over with it.'
            : 'Handed over with the package. Apply one to arrange the panels and views.'
        }
      />
      <AppliedLine library={layouts} />
      {writable ? <SaveLayoutForm library={layouts} /> : null}
      {library.project.unreadable.length > 0 ? (
        <InlineAlert tone="warning">
          {`${formatCount(library.project.unreadable.length, 'layout')} could not be read by this version and ${library.project.unreadable.length === 1 ? 'is' : 'are'} kept unchanged.`}
        </InlineAlert>
      ) : null}
      {pending && pendingLayout && pending.mode === 'rename' ? (
        <RenameForm
          key={pendingLayout.id}
          library={layouts}
          layout={pendingLayout}
          onDone={() => close(pendingLayout.id)}
        />
      ) : null}
      {pending && pendingLayout && pending.mode === 'delete' ? (
        <div
          onKeyDown={(event) => {
            // Escape keeps the layout, as in a dialog.
            if (event.key !== 'Escape') return
            event.stopPropagation()
            close(pendingLayout.id)
          }}
        >
          <InlineAlert
            tone="warning"
            // The narrow side panel stacks the buttons under the message.
            className={styles.stackedAlert}
            title={`Delete "${pendingLayout.name}"?`}
            actions={
              <>
                <Button
                  className={componentStyles.button}
                  // The safe choice takes focus, so Enter twice never deletes.
                  autoFocus
                  onPress={() => close(pendingLayout.id)}
                >
                  Keep it
                </Button>
                <Button
                  className={cx(
                    componentStyles.button,
                    componentStyles.primary,
                  )}
                  onPress={() => {
                    layouts.remove(pendingLayout.id)
                    close(pendingLayout.id)
                  }}
                >
                  Delete layout
                </Button>
              </>
            }
          >
            The layout leaves this project when you save it. This cannot be
            undone.
          </InlineAlert>
        </div>
      ) : null}
      {count === 0 ? (
        // A wrapping line, not an empty table wider than the side panel.
        <p className={cx(componentStyles.empty, styles.emptyText)}>
          {writable
            ? 'No layouts yet. Name the current panels and views above and save them.'
            : 'This package was handed over without saved layouts. Reset to handed-over layout returns to the arrangement it opened with.'}
        </p>
      ) : (
        <LayoutTable
          library={layouts}
          markedId={
            focusId !== null && layouts.find(focusId)
              ? focusId
              : (library.applied?.id ?? null)
          }
          onRename={(id) => setPending({ mode: 'rename', id })}
          onDelete={(id) => setPending({ mode: 'delete', id })}
        />
      )}
    </section>
  )
}

/** Which layout was applied last, whether it changed since, and Reset. */
function AppliedLine({ library }: { library: LayoutLibrary }) {
  const applied = useStore(library.store, (snapshot) => snapshot.applied)
  // Re-read on every arrangement and view change while the panel shows.
  useLayoutVersion()
  useViewState((view) => view)
  const changed = library.changedSinceApplied()
  if (!applied) {
    return (
      <p className={componentStyles.muted}>
        {library.writable
          ? 'No saved layout is applied in this project yet.'
          : 'No handed-over layout is applied; the panels are arranged as the package opened.'}
      </p>
    )
  }
  return (
    <div className={styles.applied}>
      <p>
        Applied: <strong>{applied.name}</strong>
        {changed ? (
          <span className={styles.changed}> · changed since applied</span>
        ) : null}
      </p>
      <ActionButton
        label={`Reset to the layout ${applied.name}`}
        disabledReason={library.resetBlocker()}
        onPress={() => library.resetToApplied()}
      >
        Reset to layout
      </ActionButton>
    </div>
  )
}

/**
 * A name and Save: the panel's way to save the current layout. The View
 * menu's Save layout… asks for the name in a prompt with the same form.
 */
export function SaveLayoutForm({
  library,
  autoFocus = false,
  onSaved,
  onCancel,
}: {
  library: LayoutLibrary
  autoFocus?: boolean
  onSaved?: () => void
  /** Shown as a Cancel button, as in the save prompt. */
  onCancel?: () => void
}) {
  // The blocker reads the library's state, which this re-reads on change.
  useStore(library.store)
  const [name, setName] = useState('')
  const [errors, setErrors] = useState<{ name?: string; form?: string }>({})
  const blocker = library.saveBlocker()

  return (
    <Form
      className={cx(styles.saveForm, !onCancel && styles.saveRow)}
      aria-label="Save the current layout"
      onSubmit={(event) => {
        event.preventDefault()
        const outcome = library.save({ name })
        if (outcome.status === 'applied') {
          setName('')
          setErrors({})
          onSaved?.()
          return
        }
        const nameIssue = issueOf(outcome, 'name')
        setErrors(
          nameIssue
            ? { name: nameIssue }
            : { form: outcome.issues[0]?.message ?? 'Not saved.' },
        )
      }}
    >
      <TextField
        className={formStyles.field}
        isInvalid={Boolean(errors.name)}
        value={name}
        onChange={(value) => {
          setName(value)
          setErrors({})
        }}
        maxLength={MAX_LAYOUT_NAME}
        autoFocus={autoFocus}
      >
        <Label className={formStyles.label}>Layout name</Label>
        <Input
          className={formStyles.input}
          placeholder="Name the current panels and views"
        />
        <FieldError className={formStyles.fieldError}>{errors.name}</FieldError>
      </TextField>
      {blocker ? <InlineAlert tone="warning">{blocker}</InlineAlert> : null}
      {errors.form ? (
        <InlineAlert tone="danger">{errors.form}</InlineAlert>
      ) : null}
      <div className={onCancel ? shellStyles.dialogActions : styles.saveAction}>
        {onCancel ? (
          <Button className={componentStyles.button} onPress={onCancel}>
            Cancel
          </Button>
        ) : null}
        <Button
          type="submit"
          className={cx(componentStyles.button, componentStyles.primary)}
        >
          Save layout
        </Button>
      </div>
    </Form>
  )
}

function RenameForm({
  library,
  layout,
  onDone,
}: {
  library: LayoutLibrary
  layout: SavedLayout
  onDone: () => void
}) {
  const [name, setName] = useState(layout.name)
  const [error, setError] = useState<string | null>(null)
  return (
    <Form
      className={styles.saveForm}
      aria-label={`Rename the layout ${layout.name}`}
      onSubmit={(event) => {
        event.preventDefault()
        const outcome = library.rename(layout.id, name)
        if (outcome.status === 'applied') {
          onDone()
          return
        }
        setError(
          issueOf(outcome, 'name') ??
            outcome.issues[0]?.message ??
            'Not renamed.',
        )
      }}
    >
      <TextField
        className={formStyles.field}
        isInvalid={Boolean(error)}
        value={name}
        onChange={(value) => {
          setName(value)
          setError(null)
        }}
        maxLength={MAX_LAYOUT_NAME}
        autoFocus
        // Escape cancels, as in a dialog.
        onKeyDown={(event) => {
          if (event.key === 'Escape') onDone()
          else event.continuePropagation()
        }}
      >
        <Label className={formStyles.label}>
          New name for &ldquo;{layout.name}&rdquo;
        </Label>
        <Input className={formStyles.input} />
        <FieldError className={formStyles.fieldError}>{error}</FieldError>
      </TextField>
      <div className={shellStyles.dialogActions}>
        <Button className={componentStyles.button} onPress={onDone}>
          Cancel
        </Button>
        <Button
          type="submit"
          className={cx(componentStyles.button, componentStyles.primary)}
        >
          Rename
        </Button>
      </div>
    </Form>
  )
}

/** The project's layouts with their details and actions, one row each. */
function LayoutTable({
  library,
  markedId,
  onRename,
  onDelete,
}: {
  library: LayoutLibrary
  markedId: string | null
  onRename: (id: string) => void
  onDelete: (id: string) => void
}) {
  const snapshot = useStore(library.store)
  const recordBlocked = useRecordBlocked()
  // "Changed since applied" follows every arrangement and view change.
  useLayoutVersion()
  useViewState((view) => view)
  const { writable } = library
  const appliedId = snapshot.applied?.id ?? null
  const changed = library.changedSinceApplied()

  const columns: DataColumn<SavedLayout>[] = [
    {
      id: 'name',
      header: 'Name',
      value: (layout) => layout.name,
      rowHeader: true,
    },
    // Actions follow the name, so a narrow panel shows them first: Apply,
    // and the changing actions in one menu (Update, Rename, Duplicate, Delete).
    {
      id: 'actions',
      header: 'Actions',
      value: () => null,
      action: true,
      width: writable ? 112 : 72,
      render: (layout) => (
        <span className={styles.rowActions} data-layout-actions={layout.id}>
          <ActionButton
            label={`Apply the layout ${layout.name}`}
            disabledReason={null}
            onPress={() => library.apply(layout.id)}
          >
            Apply
          </ActionButton>
          {writable ? (
            <MenuButton
              label={<MoreHorizontal size={14} aria-hidden="true" />}
              aria-label={`More actions for the layout ${layout.name}`}
              onBlocked={(entry, reason) => recordBlocked(entry.label, reason)}
              onAction={(id) => {
                if (id === 'update') library.update(layout.id)
                if (id === 'rename') onRename(layout.id)
                if (id === 'duplicate') library.duplicate(layout.id)
                if (id === 'delete') onDelete(layout.id)
              }}
              groups={[
                {
                  id: 'change',
                  items: [
                    {
                      id: 'update',
                      label: 'Update',
                      description:
                        'Replace it with the current panels and views',
                      disabledReason: library.changeBlocker(layout.id),
                    },
                    {
                      id: 'rename',
                      label: 'Rename…',
                      disabledReason: library.changeBlocker(layout.id),
                    },
                    {
                      id: 'duplicate',
                      label: 'Duplicate',
                      disabledReason: library.saveBlocker(),
                    },
                  ],
                },
                {
                  id: 'remove',
                  items: [
                    {
                      id: 'delete',
                      label: 'Delete…',
                      disabledReason: library.changeBlocker(layout.id),
                    },
                  ],
                },
              ]}
            />
          ) : null}
        </span>
      ),
    },
    // The viewer cannot choose the default, so State names it there instead.
    ...(writable
      ? [
          {
            id: 'default',
            header: 'Default',
            value: (layout: SavedLayout) =>
              snapshot.defaultId === layout.id ? 'Yes' : 'No',
            type: 'enum' as const,
            render: (layout: SavedLayout) => (
              <Checkbox
                className={formStyles.checkbox}
                aria-label={`Open the project with the layout ${layout.name}`}
                isSelected={snapshot.defaultId === layout.id}
                onChange={(selected) =>
                  library.setDefault(selected ? layout.id : null)
                }
              />
            ),
          },
        ]
      : []),
    {
      id: 'state',
      header: 'State',
      value: (layout) =>
        layout.id === appliedId
          ? changed
            ? 'Applied, changed since'
            : 'Applied'
          : !writable && layout.id === snapshot.defaultId
            ? 'Handed-over default'
            : null,
      type: 'enum',
      empty: '',
    },
    dateColumn('updated', 'Updated', (layout) => layout.updatedAt),
    {
      id: 'savedBy',
      header: 'Saved by',
      value: (layout) => SOURCE_LABELS[layout.createdBy],
      type: 'enum',
    },
    dateColumn('created', 'Created', (layout) => layout.createdAt),
  ]

  return (
    <WorkbenchTable
      id="layouts"
      aria-label="Layouts"
      className={styles.table}
      columns={columns}
      rows={snapshot.project.layouts}
      rowKey={(layout) => layout.id}
      currentKey={markedId}
      exportable={false}
      emptyText="No layouts."
    />
  )
}

/**
 * A date column that sorts by the time itself, not its formatted text, and
 * shows the date and time. A range filter over timestamps would mean
 * nothing, so it has none.
 */
function dateColumn(
  id: string,
  header: string,
  at: (layout: SavedLayout) => string,
): DataColumn<SavedLayout> {
  return {
    id,
    header,
    value: (layout) => {
      const time = Date.parse(at(layout))
      return Number.isNaN(time) ? null : time
    },
    type: 'number',
    grouping: false,
    filterable: false,
    render: (layout) => formatDateTime(at(layout)),
  }
}
