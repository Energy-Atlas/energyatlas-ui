import { useId, useState } from 'react'
import {
  Button,
  Checkbox,
  FieldError,
  Form,
  Input,
  Label,
  Radio,
  RadioGroup,
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
import { PropertyList } from '../components/PropertyList.tsx'
import {
  SelectableList,
  type SelectableItem,
} from '../components/SelectableList.tsx'
import { Toolbar, type ToolbarItem } from '../components/Toolbar.tsx'
import { cx } from '../cx.ts'
import { formatDateTime } from '../format.ts'
import { DialogFrame } from '../shell/HelpDialogs.tsx'
import shellStyles from '../shell/shell.module.css'
import type {
  LayoutLibrary,
  LayoutOutcome,
  LayoutRef,
} from './layoutLibrary.ts'
import { closeLayoutsDialog, layoutsDialogStore } from './layoutsDialogStore.ts'
import {
  MAX_LAYOUT_NAME,
  SCOPE_LABELS,
  type LayoutScope,
  type SavedLayout,
} from './savedLayout.ts'
import styles from './layouts.module.css'

const SOURCE_LABELS = {
  manual: 'a person',
  agent: 'the agent',
  system: 'the system',
} as const

const keyOf = (ref: LayoutRef) => `${ref.scope}:${ref.id}`

function refFromKey(key: string): LayoutRef | null {
  const [scope, ...rest] = key.split(':')
  if (scope !== 'project' && scope !== 'personal') return null
  return { scope, id: rest.join(':') }
}

function issueOf(outcome: LayoutOutcome, path: string): string | null {
  if (outcome.status !== 'rejected') return null
  return outcome.issues.find((issue) => issue.path === path)?.message ?? null
}

/**
 * Saved layouts (decision 0032): save the current panels and views as a
 * project or personal layout, and apply, update, rename, duplicate, copy,
 * delete, or choose the project's default. Built from the shared panel
 * components; results go to the status bar and Messages like any operation.
 */
export function LayoutsDialog() {
  const { open, focus, saving } = useStore(layoutsDialogStore)
  return (
    <DialogFrame
      title="Layouts"
      isOpen={open}
      onOpenChange={(isOpen) => {
        if (!isOpen) closeLayoutsDialog()
      }}
    >
      {open ? <LayoutsContent focus={focus} saving={saving} /> : null}
    </DialogFrame>
  )
}

function LayoutsContent({
  focus,
  saving,
}: {
  focus: LayoutRef | null
  saving: boolean
}) {
  const { layouts } = useServices()
  const library = useStore(layouts.store)
  const [selected, setSelected] = useState<LayoutRef | null>(focus)
  const chosen = selected ? layouts.find(selected) : null
  const listId = useId()

  const items = (scope: LayoutScope): SelectableItem[] =>
    (scope === 'project' ? library.project : library.personal).layouts.map(
      (layout) => {
        const tags = [
          scope === 'project' && library.defaultId === layout.id
            ? 'Default'
            : null,
          library.applied?.ref.scope === scope &&
          library.applied.ref.id === layout.id
            ? 'Applied'
            : null,
          `updated ${formatDateTime(layout.updatedAt)}`,
        ].filter(Boolean)
        return {
          id: keyOf({ scope, id: layout.id }),
          title: layout.name,
          meta: tags.join(' · '),
          description: tags.join(', '),
        }
      },
    )

  return (
    <div className={styles.content}>
      <AppliedLine library={layouts} />
      <SaveForm library={layouts} autoFocus={saving} onSaved={setSelected} />
      {(['project', 'personal'] as const).map((scope) => {
        const list = scope === 'project' ? library.project : library.personal
        const headingId = `${listId}-${scope}`
        return (
          <section
            key={scope}
            className={styles.scope}
            aria-labelledby={headingId}
          >
            <h3 id={headingId} className={shellStyles.dialogSection}>
              {scope === 'project' ? 'Project layouts' : 'Personal layouts'}
            </h3>
            <p className={componentStyles.muted}>
              {scope === 'project'
                ? 'Saved with this project when you save it, and handed over with it.'
                : 'Kept in this browser and available in every project.'}
            </p>
            {scope === 'personal' && library.personalStatus.kind !== 'ready' ? (
              <InlineAlert
                tone={
                  library.personalStatus.kind === 'unreadable'
                    ? 'danger'
                    : 'warning'
                }
                actions={
                  library.personalStatus.kind === 'unreadable' ? (
                    <Button
                      className={componentStyles.button}
                      onPress={() => layouts.removeUnreadablePersonal()}
                    >
                      Remove stored personal layouts
                    </Button>
                  ) : null
                }
              >
                {library.personalStatus.message}
              </InlineAlert>
            ) : null}
            {list.unreadable.length > 0 ? (
              <InlineAlert
                tone="warning"
                actions={
                  scope === 'personal' ? (
                    <Button
                      className={componentStyles.button}
                      onPress={() => layouts.removeUnreadablePersonal()}
                    >
                      Remove unreadable
                    </Button>
                  ) : null
                }
              >
                {`${list.unreadable.length} ${scope} layout${list.unreadable.length === 1 ? '' : 's'} could not be read by this version and ${list.unreadable.length === 1 ? 'is' : 'are'} kept unchanged.`}
              </InlineAlert>
            ) : null}
            <SelectableList
              aria-label={
                scope === 'project' ? 'Project layouts' : 'Personal layouts'
              }
              items={items(scope)}
              selectedId={selected?.scope === scope ? keyOf(selected) : null}
              onSelect={(key) => setSelected(refFromKey(key))}
              onAction={(key) => {
                const ref = refFromKey(key)
                if (ref) {
                  setSelected(ref)
                  layouts.apply(ref)
                }
              }}
              empty={
                <p className={componentStyles.empty}>
                  {scope === 'project'
                    ? 'No project layouts yet. Save the current layout as a project layout above.'
                    : library.personalStatus.kind === 'ready'
                      ? 'No personal layouts yet. Save the current layout as a personal layout above.'
                      : 'No personal layouts can be shown.'}
                </p>
              }
            />
          </section>
        )
      })}
      {chosen && selected ? (
        <LayoutDetail
          key={keyOf(selected)}
          library={layouts}
          layout={chosen}
          isDefault={
            selected.scope === 'project' && library.defaultId === chosen.id
          }
          onSelect={setSelected}
        />
      ) : (
        <p className={componentStyles.muted}>
          Choose a layout to apply or change it. Enter or a double-click on a
          layout applies it.
        </p>
      )}
    </div>
  )
}

/** Which layout was applied last, whether it changed since, and Reset. */
function AppliedLine({ library }: { library: LayoutLibrary }) {
  const applied = useStore(library.store, (snapshot) => snapshot.applied)
  // Re-read on every arrangement and view change while the dialog is open.
  useLayoutVersion()
  useViewState((view) => view)
  const changed = library.changedSinceApplied()
  const blocker = library.resetBlocker()
  if (!applied) {
    return (
      <p className={componentStyles.muted}>
        No saved layout is applied in this project yet.
      </p>
    )
  }
  return (
    <div className={styles.applied}>
      <p>
        Applied: <strong>{applied.name}</strong> (
        {SCOPE_LABELS[applied.ref.scope].toLowerCase()})
        {changed ? (
          <span className={styles.changed}> · changed since applied</span>
        ) : null}
      </p>
      <ActionButton
        label={`Reset to the layout ${applied.name}`}
        disabledReason={blocker}
        onPress={() => library.resetToApplied()}
      >
        Reset to layout
      </ActionButton>
    </div>
  )
}

function SaveForm({
  library,
  autoFocus,
  onSaved,
}: {
  library: LayoutLibrary
  autoFocus: boolean
  onSaved: (ref: LayoutRef) => void
}) {
  // Blockers read the library's state, which this re-reads on every change.
  useStore(library.store)
  const [name, setName] = useState('')
  const [scope, setScope] = useState<LayoutScope>(
    library.projectWritable ? 'project' : 'personal',
  )
  const [errors, setErrors] = useState<{ name?: string; form?: string }>({})
  const blocker = library.saveBlocker(scope)
  const headingId = useId()

  return (
    <section className={styles.scope} aria-labelledby={headingId}>
      <h3 id={headingId} className={shellStyles.dialogSection}>
        Save the current layout
      </h3>
      <Form
        className={styles.saveForm}
        onSubmit={(event) => {
          event.preventDefault()
          const outcome = library.save({ name, scope })
          if (outcome.status === 'applied') {
            setName('')
            setErrors({})
            if (outcome.ref) onSaved(outcome.ref)
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
          <Input className={formStyles.input} />
          <FieldError className={formStyles.fieldError}>
            {errors.name}
          </FieldError>
        </TextField>
        <RadioGroup
          className={formStyles.field}
          value={scope}
          onChange={(value) => {
            setScope(value as LayoutScope)
            setErrors({})
          }}
        >
          <Label className={formStyles.label}>Keep it</Label>
          <div className={formStyles.options}>
            <Radio
              value="project"
              className={formStyles.radio}
              isDisabled={!library.projectWritable}
            >
              With the project
            </Radio>
            <Radio value="personal" className={formStyles.radio}>
              In this browser, for every project
            </Radio>
          </div>
        </RadioGroup>
        {blocker ? <InlineAlert tone="warning">{blocker}</InlineAlert> : null}
        {errors.form ? (
          <InlineAlert tone="danger">{errors.form}</InlineAlert>
        ) : null}
        <div className={shellStyles.dialogActions}>
          <Button
            type="submit"
            className={cx(componentStyles.button, componentStyles.primary)}
          >
            Save layout
          </Button>
        </div>
      </Form>
    </section>
  )
}

function LayoutDetail({
  library,
  layout,
  isDefault,
  onSelect,
}: {
  library: LayoutLibrary
  layout: SavedLayout
  isDefault: boolean
  onSelect: (ref: LayoutRef | null) => void
}) {
  const recordBlocked = useRecordBlocked()
  const ref: LayoutRef = { scope: layout.scope, id: layout.id }
  const [mode, setMode] = useState<'idle' | 'rename' | 'delete'>('idle')
  const [name, setName] = useState(layout.name)
  const [nameError, setNameError] = useState<string | null>(null)
  const headingId = useId()
  // Blockers read the library's state, which this re-reads on every change.
  useStore(library.store)
  const changeBlocker = library.changeBlocker(ref)
  const other: LayoutScope = layout.scope === 'project' ? 'personal' : 'project'

  const items: ToolbarItem[] = [
    {
      id: 'apply',
      label: 'Apply',
      ariaLabel: `Apply the layout ${layout.name}`,
      primary: true,
      onPress: () => library.apply(ref),
    },
    {
      id: 'update',
      label: 'Update',
      ariaLabel: `Update the layout ${layout.name} with the current panels and views`,
      disabledReason: changeBlocker,
      onPress: () => library.update(ref),
    },
    {
      id: 'rename',
      label: 'Rename…',
      ariaLabel: `Rename the layout ${layout.name}`,
      disabledReason: changeBlocker,
      onPress: () => {
        setName(layout.name)
        setNameError(null)
        setMode('rename')
      },
    },
    {
      id: 'duplicate',
      label: 'Duplicate',
      ariaLabel: `Duplicate the layout ${layout.name}`,
      group: 'copy',
      disabledReason: library.saveBlocker(layout.scope),
      onPress: () => {
        const outcome = library.duplicate(ref)
        if (outcome.status === 'applied' && outcome.ref) onSelect(outcome.ref)
      },
    },
    {
      id: 'copy',
      label: `Copy to ${SCOPE_LABELS[other].toLowerCase()}`,
      ariaLabel: `Copy the layout ${layout.name} to the ${SCOPE_LABELS[other].toLowerCase()} layouts`,
      group: 'copy',
      disabledReason: library.saveBlocker(other),
      onPress: () => {
        const outcome = library.duplicate(ref, 'manual', other)
        if (outcome.status === 'applied' && outcome.ref) onSelect(outcome.ref)
      },
    },
    {
      id: 'delete',
      label: 'Delete…',
      ariaLabel: `Delete the layout ${layout.name}`,
      group: 'delete',
      disabledReason: changeBlocker,
      onPress: () => setMode('delete'),
    },
  ]

  return (
    <section className={styles.detail} aria-labelledby={headingId}>
      <h3 id={headingId} className={shellStyles.dialogSection}>
        {layout.name}
      </h3>
      <PropertyList
        aria-label={`About the layout ${layout.name}`}
        items={[
          {
            label: 'Kept',
            value:
              layout.scope === 'project'
                ? 'With the project'
                : 'In this browser',
          },
          isDefault && { label: 'Opens with the project', value: 'Yes' },
          { label: 'Saved by', value: SOURCE_LABELS[layout.createdBy] },
          { label: 'Created', value: formatDateTime(layout.createdAt) },
          { label: 'Updated', value: formatDateTime(layout.updatedAt) },
        ]}
      />
      {layout.scope === 'project' && library.projectWritable ? (
        <Checkbox
          className={formStyles.checkbox}
          isSelected={isDefault}
          onChange={(selected) =>
            library.setDefault(selected ? layout.id : null)
          }
        >
          Open the project with this layout
        </Checkbox>
      ) : null}
      <Toolbar
        aria-label={`Actions for the layout ${layout.name}`}
        items={items}
        onBlocked={(item, reason) => recordBlocked(item.label, reason)}
      />
      {mode === 'rename' ? (
        <Form
          className={styles.inlineForm}
          onSubmit={(event) => {
            event.preventDefault()
            const outcome = library.rename(ref, name)
            if (outcome.status === 'applied') {
              setMode('idle')
              return
            }
            setNameError(
              issueOf(outcome, 'name') ??
                outcome.issues[0]?.message ??
                'Not renamed.',
            )
          }}
        >
          <TextField
            className={formStyles.field}
            isInvalid={Boolean(nameError)}
            value={name}
            onChange={(value) => {
              setName(value)
              setNameError(null)
            }}
            maxLength={MAX_LAYOUT_NAME}
            autoFocus
          >
            <Label className={formStyles.label}>New name</Label>
            <Input className={formStyles.input} />
            <FieldError className={formStyles.fieldError}>
              {nameError}
            </FieldError>
          </TextField>
          <div className={shellStyles.dialogActions}>
            <Button
              className={componentStyles.button}
              onPress={() => setMode('idle')}
            >
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
      ) : null}
      {mode === 'delete' ? (
        <InlineAlert
          tone="warning"
          title={`Delete "${layout.name}"?`}
          actions={
            <>
              <Button
                className={componentStyles.button}
                onPress={() => setMode('idle')}
              >
                Keep it
              </Button>
              <Button
                className={cx(componentStyles.button, componentStyles.primary)}
                autoFocus
                onPress={() => {
                  const outcome = library.remove(ref)
                  if (outcome.status === 'applied') onSelect(null)
                  else setMode('idle')
                }}
              >
                Delete layout
              </Button>
            </>
          }
        >
          {layout.scope === 'project'
            ? 'The layout leaves this project when you save it. This cannot be undone.'
            : 'The layout is removed from this browser at once. This cannot be undone.'}
        </InlineAlert>
      ) : null}
    </section>
  )
}
