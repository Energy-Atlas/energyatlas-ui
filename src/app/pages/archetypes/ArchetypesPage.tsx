import { useId, useMemo, useState } from 'react'
import {
  FieldError,
  Form,
  Input,
  Label,
  ListBox,
  ListBoxItem,
  TextField,
} from 'react-aria-components'
import {
  previewAssignment,
  scheduleStats,
} from '../../../domain/archetypes/assignment.ts'
import { ARCHETYPE_LIBRARY } from '../../../domain/archetypes/library.ts'
import { stageSubmitBlocker } from '../../../domain/commands.ts'
import type { Archetype, BuildingUse, Schedule } from '../../../domain/types.ts'
import { STAGE_IDS } from '../../../domain/workflow.ts'
import {
  useClientSnapshot,
  useServices,
  useStageStates,
  useWorkbenchSnapshot,
} from '../../WorkbenchContext.tsx'
import { splitIssues } from '../../commandErrors.ts'
import { ActionButton } from '../../components/ActionButton.tsx'
import { CapabilityBadge } from '../../components/CapabilityBadge.tsx'
import { StateBadge } from '../../components/StateBadge.tsx'
import componentStyles from '../../components/components.module.css'
import formStyles from '../../components/forms.module.css'
import { waitingReason } from '../../service/usePendingReason.ts'
import {
  ScheduleEditor,
  parseProfile,
  type ProfileDraft,
} from './ScheduleEditor.tsx'
import styles from './archetypes.module.css'

const NEW = 'new'

const USE_LABELS: Record<BuildingUse, string> = {
  residential: 'Residential',
  office: 'Office',
  retail: 'Retail',
  school: 'School',
  mixed: 'Mixed use',
}

const USES = (Object.keys(USE_LABELS) as BuildingUse[]).map((value) => ({
  value,
  label: USE_LABELS[value],
}))

type ArchetypeDraft = {
  id: string | null
  name: string
  use: BuildingUse
  yearFrom: string
  yearTo: string
  euiKwhPerM2: string
  scheduleId: string
}

function withoutKey(
  record: Record<string, string>,
  key: string,
): Record<string, string> {
  if (!(key in record)) return record
  const next = { ...record }
  delete next[key]
  return next
}

function toDraft(archetype: Archetype | null): ArchetypeDraft {
  return {
    id: archetype?.id ?? null,
    name: archetype?.name ?? '',
    use: archetype?.use ?? 'residential',
    yearFrom: archetype?.yearFrom?.toString() ?? '',
    yearTo: archetype?.yearTo?.toString() ?? '',
    euiKwhPerM2: archetype?.euiKwhPerM2.toString() ?? '150',
    scheduleId: archetype?.scheduleId ?? '',
  }
}

function optionalYear(value: string): number | null {
  return value.trim() === '' ? null : Number(value)
}

function isUse(value: string): value is BuildingUse {
  return value in USE_LABELS
}

function rangeLabel(archetype: Archetype): string {
  if (archetype.yearFrom === null && archetype.yearTo === null)
    return 'Any year'
  if (archetype.yearFrom === null) return `Up to ${archetype.yearTo}`
  if (archetype.yearTo === null) return `From ${archetype.yearFrom}`
  return `${archetype.yearFrom} to ${archetype.yearTo}`
}

function ArchetypeEditor({
  archetype,
  schedules,
  onCreated,
}: {
  archetype: Archetype | null
  schedules: Schedule[]
  onCreated: (id: string) => void
}) {
  const headingId = useId()
  const { client } = useServices()
  const pending = useClientSnapshot((snapshot) => snapshot.pending)
  const [draft, setDraft] = useState(() => toDraft(archetype))
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [message, setMessage] = useState<string | null>(null)
  const saving = waitingReason(
    pending,
    'archetype.save',
    'the archetype is being saved',
  )
  const { workbench } = useServices()
  const update = (field: keyof ArchetypeDraft, value: string) => {
    setDraft({ ...draft, [field]: value })
    setErrors((current) => withoutKey(current, field))
  }
  return (
    <section className={formStyles.form} aria-labelledby={headingId}>
      <div className={formStyles.formHeader}>
        <h3 id={headingId}>
          {archetype ? `Edit ${archetype.name}` : 'New archetype'}
        </h3>
        {archetype ? (
          <span className={componentStyles.muted}>
            {archetype.source.kind === 'library'
              ? 'From the synthetic library'
              : archetype.source.libraryId
                ? `Edited copy of a library archetype (operation ${archetype.source.operationId})`
                : `Created in this project (operation ${archetype.source.operationId})`}
          </span>
        ) : null}
      </div>
      <Form
        className={styles.fields}
        validationBehavior="aria"
        onSubmit={(event) => {
          event.preventDefault()
          if (saving) return
          // Numbers are checked here so a blank or mistyped value is never sent as NaN.
          const local: Record<string, string> = {}
          for (const field of ['yearFrom', 'yearTo'] as const) {
            const value = optionalYear(draft[field])
            if (value !== null && !Number.isInteger(value)) {
              local[field] = 'Enter a whole year, or leave it empty.'
            }
          }
          if (
            !Number.isFinite(Number(draft.euiKwhPerM2)) ||
            !draft.euiKwhPerM2.trim()
          ) {
            local.euiKwhPerM2 = 'Enter the energy use intensity as a number.'
          }
          if (Object.keys(local).length > 0) {
            setErrors(local)
            setMessage(null)
            return
          }
          void client
            .execute({
              type: 'archetype.save',
              input: {
                ...(draft.id ? { id: draft.id } : {}),
                name: draft.name,
                use: draft.use,
                yearFrom: optionalYear(draft.yearFrom),
                yearTo: optionalYear(draft.yearTo),
                euiKwhPerM2: Number(draft.euiKwhPerM2),
                scheduleId: draft.scheduleId || null,
              },
            })
            .then((result) => {
              if (result.outcome.status === 'applied') {
                setErrors({})
                setMessage(result.outcome.summary)
                if (!draft.id) {
                  const created = Object.values(
                    workbench.getState().archetypes,
                  ).find((item) => item.name === draft.name.trim())
                  if (created) onCreated(created.id)
                }
                return
              }
              const { fieldErrors, general } = splitIssues(
                result.outcome.issues,
              )
              setErrors(fieldErrors)
              setMessage(general)
            })
        }}
      >
        <TextField
          className={formStyles.field}
          value={draft.name}
          isInvalid={Boolean(errors.name)}
          onChange={(value) => update('name', value)}
        >
          <Label className={formStyles.label}>Archetype name</Label>
          <Input className={formStyles.input} />
          <FieldError className={formStyles.fieldError}>
            {errors.name}
          </FieldError>
        </TextField>
        <NativeSelect
          label="Building use"
          value={draft.use}
          error={errors.use}
          options={USES.map((use) => ({ value: use.value, label: use.label }))}
          onChange={(value) => {
            if (isUse(value)) update('use', value)
          }}
        />
        <NumberText
          label="Built from (year, optional)"
          value={draft.yearFrom}
          error={errors.yearFrom}
          onChange={(value) => update('yearFrom', value)}
        />
        <NumberText
          label="Built to (year, optional)"
          value={draft.yearTo}
          error={errors.yearTo}
          onChange={(value) => update('yearTo', value)}
        />
        <NumberText
          label="Energy use intensity (kWh/m² per year)"
          value={draft.euiKwhPerM2}
          error={errors.euiKwhPerM2}
          onChange={(value) => update('euiKwhPerM2', value)}
        />
        <NativeSelect
          label="Schedule"
          value={draft.scheduleId}
          error={errors.scheduleId}
          options={[
            { value: '', label: 'None' },
            ...schedules.map((schedule) => ({
              value: schedule.id,
              label: schedule.name,
            })),
          ]}
          onChange={(value) => update('scheduleId', value)}
        />
        <div className={styles.formActions}>
          <button
            type="submit"
            className={`${componentStyles.button} ${componentStyles.primary}`}
            aria-disabled={saving ? true : undefined}
            title={saving ?? undefined}
          >
            {archetype ? 'Save archetype' : 'Create archetype'}
          </button>
        </div>
        {message ? (
          <p className={formStyles.description} role="status">
            {message}
          </p>
        ) : null}
      </Form>
    </section>
  )
}

function NativeSelect({
  label,
  value,
  error,
  options,
  onChange,
}: {
  label: string
  value: string
  error: string | undefined
  options: { value: string; label: string }[]
  onChange: (value: string) => void
}) {
  const id = useId()
  return (
    <div className={formStyles.field}>
      <label className={formStyles.label} htmlFor={id}>
        {label}
      </label>
      <select
        id={id}
        className={formStyles.input}
        value={value}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-error` : undefined}
        onChange={(event) => onChange(event.target.value)}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      {error ? (
        <span id={`${id}-error`} className={formStyles.fieldError}>
          {error}
        </span>
      ) : null}
    </div>
  )
}

function NumberText({
  label,
  value,
  error,
  onChange,
}: {
  label: string
  value: string
  error: string | undefined
  onChange: (value: string) => void
}) {
  return (
    <TextField
      className={formStyles.field}
      value={value}
      inputMode="numeric"
      isInvalid={Boolean(error)}
      onChange={onChange}
    >
      <Label className={formStyles.label}>{label}</Label>
      <Input className={formStyles.input} />
      <FieldError className={formStyles.fieldError}>{error}</FieldError>
    </TextField>
  )
}

function ScheduleForm({
  schedule,
  onCreated,
}: {
  schedule: Schedule | null
  onCreated: (id: string) => void
}) {
  const headingId = useId()
  const { client, workbench } = useServices()
  const pending = useClientSnapshot((snapshot) => snapshot.pending)
  const [name, setName] = useState(schedule?.name ?? '')
  const [profile, setProfile] = useState<ProfileDraft>(() => ({
    weekday: (schedule?.weekday ?? Array.from({ length: 24 }, () => 0)).map(
      String,
    ),
    weekend: (schedule?.weekend ?? Array.from({ length: 24 }, () => 0)).map(
      String,
    ),
  }))
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [message, setMessage] = useState<string | null>(null)
  const saving = waitingReason(
    pending,
    'schedule.save',
    'the schedule is being saved',
  )
  return (
    <section className={formStyles.form} aria-labelledby={headingId}>
      <div className={formStyles.formHeader}>
        <h3 id={headingId}>
          {schedule ? `Edit ${schedule.name}` : 'New schedule'}
        </h3>
      </div>
      <Form
        className={styles.fields}
        validationBehavior="aria"
        onSubmit={(event) => {
          event.preventDefault()
          if (saving) return
          const hours = [
            ...parseProfile(profile.weekday),
            ...parseProfile(profile.weekend),
          ]
          if (hours.some((value) => !Number.isFinite(value))) {
            setErrors({ weekday: 'Enter a number from 0 to 1 in every hour.' })
            setMessage(null)
            return
          }
          void client
            .execute({
              type: 'schedule.save',
              input: {
                ...(schedule ? { id: schedule.id } : {}),
                name,
                weekday: parseProfile(profile.weekday),
                weekend: parseProfile(profile.weekend),
              },
            })
            .then((result) => {
              if (result.outcome.status === 'applied') {
                setErrors({})
                setMessage(result.outcome.summary)
                if (!schedule) {
                  const created = Object.values(
                    workbench.getState().schedules,
                  ).find((item) => item.name === name.trim())
                  if (created) onCreated(created.id)
                }
                return
              }
              const { fieldErrors, general } = splitIssues(
                result.outcome.issues.map((issue) => ({
                  ...issue,
                  path: issue.path.split('.')[0] ?? '',
                })),
              )
              setErrors(fieldErrors)
              setMessage(general)
            })
        }}
      >
        <TextField
          className={formStyles.field}
          value={name}
          isInvalid={Boolean(errors.name)}
          onChange={(value) => {
            setName(value)
            setErrors((current) => withoutKey(current, 'name'))
          }}
        >
          <Label className={formStyles.label}>Schedule name</Label>
          <Input className={formStyles.input} />
          <FieldError className={formStyles.fieldError}>
            {errors.name}
          </FieldError>
        </TextField>
        <ScheduleEditor
          draft={profile}
          errors={errors}
          onChange={(next) => {
            setProfile(next)
            setErrors((current) =>
              withoutKey(withoutKey(current, 'weekday'), 'weekend'),
            )
          }}
        />
        {message ? (
          <p className={formStyles.description} role="status">
            {message}
          </p>
        ) : null}
        <button
          type="submit"
          className={`${componentStyles.button} ${componentStyles.primary}`}
          aria-disabled={saving ? true : undefined}
          title={saving ?? undefined}
        >
          {schedule ? 'Save schedule' : 'Create schedule'}
        </button>
      </Form>
    </section>
  )
}

/**
 * Archetypes and schedules (jobs rollout plan, slice 5): the project's
 * archetype definitions and schedules, a compact editor for each, the
 * synthetic library, and the coverage that running Archetype modeling would
 * produce. Definitions save as model changes; assignment runs as a job.
 */
export function ArchetypesPage() {
  const headingId = useId()
  const { client } = useServices()
  const state = useWorkbenchSnapshot((snapshot) => snapshot.state)
  const pending = useClientSnapshot((snapshot) => snapshot.pending)
  const stageStates = useStageStates()
  const [selected, setSelected] = useState<string>(NEW)
  const [selectedSchedule, setSelectedSchedule] = useState<string>(NEW)
  const [libraryChoice, setLibraryChoice] = useState('')
  const archetypes = Object.values(state.archetypes)
  const schedules = Object.values(state.schedules)
  const preview = useMemo(() => previewAssignment(state), [state])
  const archetype = state.archetypes[selected] ?? null
  const schedule = state.schedules[selectedSchedule] ?? null
  const available = ARCHETYPE_LIBRARY.filter(
    (entry) => !state.archetypes[entry.id],
  )
  const runBlocker =
    waitingReason(
      pending,
      'workflow.runStage',
      'the run is being queued',
      (input) =>
        (input as { stageId?: unknown }).stageId === STAGE_IDS.archetypes,
    ) ?? stageSubmitBlocker(state, STAGE_IDS.archetypes)
  const archetypeItems: ListItem[] = [
    { id: NEW, name: 'New archetype…', meta: null },
    ...archetypes.map((item) => ({
      id: item.id,
      name: item.name,
      meta: `${USE_LABELS[item.use]} · ${rangeLabel(item)} · ${item.euiKwhPerM2} kWh/m² · ${preview.byArchetype[item.id] ?? 0} buildings`,
    })),
  ]
  const scheduleItems: ListItem[] = [
    { id: NEW, name: 'New schedule…', meta: null },
    ...schedules.map((item) => ({
      id: item.id,
      name: item.name,
      meta: `${scheduleStats(item).weeklyHours} full-load hours a week`,
    })),
  ]

  return (
    <section
      className={`${componentStyles.page} ${styles.page}`}
      aria-labelledby={headingId}
    >
      <header className={styles.header}>
        <h2 id={headingId}>Archetypes and schedules</h2>
        <CapabilityBadge id="archetypes.library" />
        <span className={styles.stage}>
          Archetype modeling{' '}
          <StateBadge state={stageStates[STAGE_IDS.archetypes] ?? 'future'} />
        </span>
      </header>

      <div className={styles.split}>
        <div className={styles.listPane}>
          <h3 className={styles.sectionTitle}>Project archetypes</h3>
          {archetypes.length === 0 ? (
            <p className={componentStyles.empty}>
              No archetypes yet. The first Archetype modeling run adds the
              default synthetic library archetypes the project lacks; you can
              also add or create archetypes first.
            </p>
          ) : null}
          <DefinitionList
            label="Project archetypes"
            items={archetypeItems}
            selected={selected}
            onSelect={setSelected}
          />
          <div className={styles.library}>
            <label className={formStyles.label} htmlFor={`${headingId}-lib`}>
              Synthetic library
            </label>
            <select
              id={`${headingId}-lib`}
              className={formStyles.input}
              value={libraryChoice}
              onChange={(event) => setLibraryChoice(event.target.value)}
            >
              <option value="">Choose an archetype…</option>
              {available.map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {entry.name}
                </option>
              ))}
            </select>
            <ActionButton
              label="Add the chosen library archetype to the project"
              disabledReason={
                waitingReason(
                  pending,
                  'archetype.addFromLibrary',
                  'the archetype is being added',
                ) ??
                (available.length === 0
                  ? 'Every library archetype is already in the project.'
                  : libraryChoice
                    ? null
                    : 'Choose a library archetype first.')
              }
              onPress={() =>
                void client
                  .execute({
                    type: 'archetype.addFromLibrary',
                    input: { libraryId: libraryChoice },
                  })
                  .then((result) => {
                    if (result.outcome.status === 'applied') {
                      setSelected(libraryChoice)
                      setLibraryChoice('')
                    }
                  })
              }
            >
              Add
            </ActionButton>
          </div>
        </div>
        <ArchetypeEditor
          key={selected}
          archetype={archetype}
          schedules={schedules}
          onCreated={(id) => setSelected(id)}
        />
      </div>

      <div className={styles.split}>
        <div className={styles.listPane}>
          <h3 className={styles.sectionTitle}>Schedules</h3>
          <DefinitionList
            label="Schedules"
            items={scheduleItems}
            selected={selectedSchedule}
            onSelect={setSelectedSchedule}
          />
        </div>
        <ScheduleForm
          key={selectedSchedule}
          schedule={schedule}
          onCreated={(id) => setSelectedSchedule(id)}
        />
      </div>

      <section aria-label="Assignment coverage" className={styles.section}>
        <h3 className={styles.sectionTitle}>Assignment coverage</h3>
        <p>
          With the current definitions, {preview.assigned} buildings get an
          archetype and {preview.unassigned} get none; {preview.changes}{' '}
          assignments would change and {preview.overrides} manual overrides are
          kept.
        </p>
        {preview.rows.length > 0 ? (
          <table
            className={componentStyles.table}
            aria-label="Assignment coverage"
          >
            <thead>
              <tr>
                <th scope="col">Use</th>
                <th scope="col">Buildings</th>
                <th scope="col">Assigned</th>
                <th scope="col">Unassigned</th>
                <th scope="col">Manual overrides</th>
              </tr>
            </thead>
            <tbody>
              {preview.rows.map((row) => (
                <tr key={row.use}>
                  <td>
                    {row.use === 'unknown'
                      ? 'Use not known'
                      : USE_LABELS[row.use]}
                  </td>
                  <td>{row.buildings}</td>
                  <td>{row.assigned}</td>
                  <td>{row.unassigned}</td>
                  <td>{row.overridden}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className={componentStyles.empty}>
            No buildings yet. Run the workflow from Location setup first.
          </p>
        )}
        <div className={styles.formActions}>
          <ActionButton
            label="Run Archetype modeling to assign buildings"
            variant="primary"
            disabledReason={runBlocker}
            onPress={() =>
              void client.execute({
                type: 'workflow.runStage',
                input: { stageId: STAGE_IDS.archetypes },
              })
            }
          >
            Run assignment
          </ActionButton>
          <span className={componentStyles.muted}>
            Assignment runs as a job; buildings change only when every building
            has been assigned.
          </span>
        </div>
      </section>
    </section>
  )
}

type ListItem = { id: string; name: string; meta: string | null }

function DefinitionList({
  label,
  items,
  selected,
  onSelect,
}: {
  label: string
  items: ListItem[]
  selected: string
  onSelect: (id: string) => void
}) {
  return (
    <ListBox
      aria-label={label}
      className={styles.list}
      items={items}
      selectionMode="single"
      selectionBehavior="replace"
      disallowEmptySelection
      selectedKeys={[selected]}
      onSelectionChange={(keys) => {
        if (keys === 'all') return
        const [key] = [...keys]
        if (typeof key === 'string') onSelect(key)
      }}
    >
      {(item) => (
        <ListBoxItem id={item.id} className={styles.row} textValue={item.name}>
          <span className={styles.rowTitle}>{item.name}</span>
          {item.meta ? (
            <span className={styles.rowMeta}>{item.meta}</span>
          ) : null}
        </ListBoxItem>
      )}
    </ListBox>
  )
}
