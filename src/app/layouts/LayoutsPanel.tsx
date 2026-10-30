import { MoreHorizontal } from 'lucide-react'
import { useId, useRef, useState } from 'react'
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
import { ConfirmDialog } from '../components/ConfirmDialog.tsx'
import formStyles from '../components/forms.module.css'
import { InlineAlert } from '../components/InlineAlert.tsx'
import { MenuButton } from '../components/MenuButton.tsx'
import { PropertyList } from '../components/PropertyList.tsx'
import { HeaderCount, PanelHeader } from '../components/PanelHeader.tsx'
import { WorkbenchTable } from '../components/WorkbenchTable.tsx'
import { cx } from '../cx.ts'
import { formatCount, formatDateTime } from '../format.ts'
import { DialogFrame } from '../shell/HelpDialogs.tsx'
import shellStyles from '../shell/shell.module.css'
import type { DataColumn } from '../tables/tableModel.ts'
import type { LayoutLibrary, LayoutOutcome } from './layoutLibrary.ts'
import { focusLayout, layoutsPanelStore } from './layoutsPanelStore.ts'
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
  // The chosen row: picked in the table or the asset tree, else the applied one.
  const markedId =
    focusId !== null && layouts.find(focusId)
      ? focusId
      : (library.applied?.id ?? null)
  const markedLayout = markedId ? layouts.find(markedId) : null
  const { writable } = layouts
  const count = library.project.layouts.length
  const panelRef = useRef<HTMLElement>(null)
  // The prompt and the confirmation open from a row's menu, which is gone by
  // the time they close, so focus goes back to that row's actions menu, or to
  // the table once the row was deleted, never to the page.
  const rowFocus = (id: string | undefined) => (): HTMLElement | null => {
    const panel = panelRef.current
    if (!panel) return null
    const actions = [
      ...panel.querySelectorAll<HTMLElement>('[data-layout-actions]'),
    ].find((each) => each.dataset.layoutActions === id)
    return (
      actions?.querySelector<HTMLElement>('button[aria-haspopup]') ??
      panel.querySelector<HTMLElement>('[role="grid"]') ??
      panel.querySelector<HTMLElement>('input')
    )
  }
  const close = () => {
    const target = rowFocus(pending?.id)
    setPending(null)
    window.requestAnimationFrame(() => {
      const active = document.activeElement
      if (!active || active === document.body) target()?.focus()
    })
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
      {/* Rename asks in a prompt and Delete in the confirmation dialog
          (decision 0036), so neither pushes the table down. */}
      <DialogFrame
        title="Rename layout"
        isOpen={pending?.mode === 'rename' && pendingLayout !== null}
        onOpenChange={(open) => {
          if (!open) close()
        }}
      >
        {pending?.mode === 'rename' && pendingLayout ? (
          <RenameForm
            key={pendingLayout.id}
            library={layouts}
            layout={pendingLayout}
            onDone={() => close()}
          />
        ) : null}
      </DialogFrame>
      <ConfirmDialog
        isOpen={pending?.mode === 'delete' && pendingLayout !== null}
        onOpenChange={(open) => {
          if (!open) close()
        }}
        title={`Delete "${pendingLayout?.name ?? ''}"?`}
        confirm={{
          label: 'Delete layout',
          onPress: () => {
            if (!pendingLayout) return
            const outcome = layouts.remove(pendingLayout.id)
            return outcome.status === 'rejected'
              ? (outcome.issues[0]?.message ?? 'Not deleted.')
              : null
          },
        }}
        returnFocus={rowFocus(pending?.id)}
      >
        <p>
          The layout leaves this project when you save it. This cannot be
          undone.
        </p>
      </ConfirmDialog>
      {count === 0 ? (
        // A wrapping line, not an empty table wider than the side panel.
        <p className={cx(componentStyles.empty, styles.emptyText)}>
          {writable
            ? 'No layouts yet. Name the current panels and views above and save them.'
            : 'This package was handed over without saved layouts. Reset to handed-over layout returns to the arrangement it opened with.'}
        </p>
      ) : (
        <>
          <LayoutTable
            library={layouts}
            markedId={markedId}
            onRename={(id) => setPending({ mode: 'rename', id })}
            onDelete={(id) => setPending({ mode: 'delete', id })}
          />
          {markedLayout ? (
            <LayoutDetails library={layouts} layout={markedLayout} />
          ) : null}
        </>
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
    // The view's default is shown but cannot be changed in the viewer.
    {
      id: 'default',
      header: 'Default',
      value: (layout: SavedLayout) =>
        snapshot.defaultId === layout.id ? 'Yes' : 'No',
      type: 'enum' as const,
      render: (layout: SavedLayout) => (
        <Checkbox
          className={formStyles.checkbox}
          aria-label={
            writable
              ? `Open the project with the layout ${layout.name}`
              : `The view opens with the layout ${layout.name}`
          }
          isSelected={snapshot.defaultId === layout.id}
          isReadOnly={!writable}
          onChange={(selected) => {
            if (writable) library.setDefault(selected ? layout.id : null)
          }}
        />
      ),
    },
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
      // Choosing a row shows its details under the table.
      selection={{ selectedKey: markedId, onSelect: focusLayout }}
      exportable={false}
      emptyText="No layouts."
    />
  )
}

/**
 * The chosen layout's details (decision 0036): what left the table so the
 * side panel shows Name, its actions, and Default without scrolling
 * sideways. They sit under the table rather than in Properties, which shares
 * the right side with this panel and would hide it.
 */
function LayoutDetails({
  library,
  layout,
}: {
  library: LayoutLibrary
  layout: SavedLayout
}) {
  const snapshot = useStore(library.store)
  // "Changed since applied" follows every arrangement and view change.
  useLayoutVersion()
  useViewState((view) => view)
  const headingId = useId()
  const applied = snapshot.applied?.id === layout.id
  const state = applied
    ? library.changedSinceApplied()
      ? 'Applied, changed since'
      : 'Applied'
    : 'Not applied'
  return (
    <section className={styles.details} aria-labelledby={headingId}>
      <h3 id={headingId} className={styles.detailsHeading}>
        {layout.name}
      </h3>
      <PropertyList
        aria-label={`Details of the layout ${layout.name}`}
        items={[
          { label: 'State', value: state },
          {
            label: 'Default',
            value:
              snapshot.defaultId === layout.id
                ? library.writable
                  ? 'Opens with the project'
                  : 'Opens with the view'
                : 'No',
          },
          { label: 'Saved by', value: SOURCE_LABELS[layout.createdBy] },
          { label: 'Created', value: formatDateTime(layout.createdAt) },
          { label: 'Updated', value: formatDateTime(layout.updatedAt) },
        ]}
      />
    </section>
  )
}
