import { Plus, Trash2 } from 'lucide-react'
import { useId, useState } from 'react'
import { scheduleStats } from '../../domain/archetypes/assignment.ts'
import { weekdayWeekend } from '../../domain/archetypes/library.ts'
import { WEEK_DAYS, type Schedule } from '../../domain/types.ts'
import { useClientSnapshot, useServices } from '../WorkbenchContext.tsx'
import { splitIssues } from '../commandErrors.ts'
import { SegmentedFilter } from '../components/SegmentedFilter.tsx'
import { Toolbar } from '../components/Toolbar.tsx'
import formStyles from '../components/forms.module.css'
import { cx } from '../cx.ts'
import { formatNumber } from '../format.ts'
import { waitingReason } from '../service/usePendingReason.ts'
import { LIBRARY_READ_ONLY, provenanceSentence } from './definitionLabels.ts'
import {
  PropertyForm,
  TextProperty,
  usePropertyReadOnly,
} from './PropertyForm.tsx'
import { ScheduleChart } from './ScheduleChart.tsx'
import { ScheduleYear } from './ScheduleYear.tsx'
import styles from './schedule.module.css'
import { useEdits } from './useEdits.ts'

/** A day type as typed: hours stay text until saved, so a field can be blank. */
type DayDraft = { id: string; name: string; hours: string[] }

type ScheduleFields = {
  name: string
  days: DayDraft[]
  week: string[]
}

const BLANK = weekdayWeekend(
  Array.from({ length: 24 }, (_, hour) => (hour >= 8 && hour < 18 ? 0.8 : 0.1)),
  Array.from({ length: 24 }, () => 0.1),
)

function toFields(schedule: Schedule | null): ScheduleFields {
  const source = schedule ?? { name: '', ...BLANK }
  return {
    name: source.name,
    days: source.days.map((day) => ({
      id: day.id,
      name: day.name,
      hours: day.hours.map(String),
    })),
    week: [...source.week],
  }
}

function parse(value: string): number {
  return value.trim() === '' ? Number.NaN : Number(value)
}

function valid(hours: number[]): boolean {
  return hours.every(
    (value) => Number.isFinite(value) && value >= 0 && value <= 1,
  )
}

/** A day type id not yet used in the schedule. */
function freshDayId(days: DayDraft[]): string {
  let index = days.length + 1
  while (days.some((day) => day.id === `day-${index}`)) index += 1
  return `day-${index}`
}

/**
 * A schedule in Properties (decision 0028): its name, the annual average
 * and the year as a heat map (both read-only and live), which day type each
 * day of the week uses, and the day types (such as Weekday, Saturday,
 * Sunday), each drawn as 24 points to drag or typed hour by hour.
 */
export function ScheduleProperties({
  schedule,
  library = false,
  onCreated,
  onCancelCreate,
}: {
  /** Null creates a new schedule. */
  schedule: Schedule | null
  /** A synthetic library entry, shown read-only (decision 0028). */
  library?: boolean
  onCreated: (id: string) => void
  onCancelCreate: () => void
}) {
  const { client, workbench } = useServices()
  const pending = useClientSnapshot((snapshot) => snapshot.pending)
  const edits = useEdits(
    toFields(schedule),
    schedule
      ? `${library ? 'library:' : ''}schedule:${schedule.id}`
      : 'new:schedule',
  )
  const [activeId, setActiveId] = useState(
    () => edits.value.days[0]?.id ?? 'weekday',
  )
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [error, setError] = useState<string | null>(null)
  const draft = edits.value
  const creating = schedule === null
  const active = draft.days.find((day) => day.id === activeId) ?? draft.days[0]
  const savedDay = (id: string) =>
    schedule?.days.find((day) => day.id === id) ?? null

  const numbers = draft.days.map((day) => ({
    ...day,
    hours: day.hours.map(parse),
  }))
  const allValid = numbers.every((day) => valid(day.hours))
  const stats = allValid
    ? scheduleStats({ days: numbers, week: draft.week })
    : null

  const clearErrors = (...fields: string[]) =>
    setErrors((current) => {
      const next = { ...current }
      for (const field of fields) delete next[field]
      return next
    })

  const setDays = (days: DayDraft[]) => {
    edits.set('days', days)
    clearErrors('days', 'week')
  }

  const setHour = (dayId: string, hour: number, value: string) =>
    setDays(
      draft.days.map((day) =>
        day.id === dayId
          ? {
              ...day,
              hours: day.hours.map((current, index) =>
                index === hour ? value : current,
              ),
            }
          : day,
      ),
    )

  const addDayType = () => {
    if (!active) return
    const id = freshDayId(draft.days)
    setDays([
      ...draft.days,
      {
        id,
        name: `Day type ${draft.days.length + 1}`,
        hours: [...active.hours],
      },
    ])
    setActiveId(id)
  }

  const removeDayType = () => {
    if (!active || draft.days.length < 2) return
    const remaining = draft.days.filter((day) => day.id !== active.id)
    const fallback = remaining[0]?.id ?? ''
    // Days that used the removed type take the first remaining one.
    edits.patch({
      days: remaining,
      week: draft.week.map((id) => (id === active.id ? fallback : id)),
    })
    clearErrors('days', 'week')
    setActiveId(fallback)
  }

  const submit = () => {
    if (!allValid) {
      setErrors({ days: 'Enter a number from 0 to 1 in every hour.' })
      setError(null)
      return
    }
    void client
      .execute({
        type: 'schedule.save',
        input: {
          ...(schedule ? { id: schedule.id } : {}),
          name: draft.name,
          days: numbers.map((day) => ({
            id: day.id,
            name: day.name,
            hours: day.hours,
          })),
          week: draft.week,
        },
      })
      .then((result) => {
        if (result.outcome.status === 'applied') {
          setErrors({})
          setError(null)
          edits.reset()
          if (creating) {
            const created = Object.values(workbench.getState().schedules).find(
              (item) => item.name === draft.name.trim(),
            )
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
        setError(general)
      })
  }

  const saved = active ? savedDay(active.id) : null
  const dayTypes = draft.days.map((day) => ({ value: day.id, label: day.name }))

  return (
    <PropertyForm
      eyebrow={library ? 'Library schedule' : 'Schedule'}
      readOnly={
        library
          ? 'Library schedules are read-only. They come into the project with a library archetype that uses them, as an editable copy.'
          : null
      }
      title={schedule ? schedule.name : 'New schedule'}
      provenance={schedule ? provenanceSentence(schedule.source) : undefined}
      creating={creating}
      editedCount={edits.editedCount}
      error={error}
      waiting={waitingReason(
        pending,
        'schedule.save',
        'the schedule is being saved',
      )}
      submitLabel={creating ? 'Create schedule' : 'Save schedule'}
      onSubmit={submit}
      onCancel={() => {
        if (!schedule) {
          onCancelCreate()
          return
        }
        edits.reset()
        setErrors({})
        setError(null)
        setActiveId(schedule.days[0]?.id ?? 'weekday')
      }}
    >
      <TextProperty
        label="Schedule name"
        value={draft.name}
        edited={!creating && edits.isEdited('name')}
        error={errors.name}
        onChange={(value) => {
          edits.set('name', value)
          clearErrors('name')
        }}
      />

      <AnnualAverage value={stats?.annualAverage ?? null} />
      {allValid ? (
        <ScheduleYear schedule={{ days: numbers, week: draft.week }} />
      ) : null}

      <section className={styles.section} aria-label="Week">
        <h4 className={styles.sectionTitle}>Week</h4>
        <div className={styles.week}>
          {WEEK_DAYS.map((name, index) => (
            <WeekDay
              key={name}
              name={name}
              value={draft.week[index] ?? ''}
              edited={
                schedule !== null && schedule.week[index] !== draft.week[index]
              }
              options={dayTypes}
              onChange={(id) => {
                edits.set(
                  'week',
                  draft.week.map((current, day) =>
                    day === index ? id : current,
                  ),
                )
                clearErrors('week')
              }}
            />
          ))}
        </div>
        {errors.week ? (
          <p className={styles.error} role="alert">
            {errors.week}
          </p>
        ) : null}
      </section>

      <section className={styles.section} aria-label="Day types">
        <h4 className={styles.sectionTitle}>Day types</h4>
        <div className={styles.dayBar}>
          <SegmentedFilter<string>
            aria-label="Day type to edit"
            value={active?.id ?? ''}
            onChange={setActiveId}
            segments={draft.days.map((day) => ({
              id: day.id,
              label: day.name || 'Unnamed',
            }))}
          />
          <Toolbar
            aria-label="Day types"
            items={[
              {
                id: 'add',
                label: 'Add a day type',
                icon: Plus,
                iconOnly: true,
                disabledReason: library
                  ? LIBRARY_READ_ONLY
                  : draft.days.length >= 7
                    ? 'A schedule has at most seven day types, one per day.'
                    : null,
                onPress: addDayType,
              },
              {
                id: 'remove',
                label: `Remove ${active?.name || 'this day type'}`,
                icon: Trash2,
                iconOnly: true,
                disabledReason: library
                  ? LIBRARY_READ_ONLY
                  : draft.days.length < 2
                    ? 'A schedule needs at least one day type.'
                    : null,
                onPress: removeDayType,
              },
            ]}
          />
        </div>
        {active ? (
          <>
            <TextProperty
              label="Day type name"
              value={active.name}
              edited={!creating && saved !== null && saved.name !== active.name}
              error={undefined}
              onChange={(name) =>
                setDays(
                  draft.days.map((day) =>
                    day.id === active.id ? { ...day, name } : day,
                  ),
                )
              }
            />
            <ScheduleChart
              label={active.name || 'Day type'}
              values={active.hours.map(parse)}
              saved={creating ? null : (saved?.hours ?? null)}
              readOnly={library}
              onChange={(hour, value) =>
                setHour(active.id, hour, String(value))
              }
            />
            <HourFields
              day={active}
              saved={creating ? null : saved}
              invalid={Boolean(errors.days)}
              readOnly={library}
              onChange={(hour, value) => setHour(active.id, hour, value)}
            />
          </>
        ) : null}
        {errors.days ? (
          <p className={styles.error} role="alert">
            {errors.days}
          </p>
        ) : null}
      </section>
    </PropertyForm>
  )
}

/** One day of the week and the day type it uses, compact enough for one row. */
function WeekDay({
  name,
  value,
  edited,
  options,
  onChange,
}: {
  name: string
  value: string
  edited: boolean
  options: { value: string; label: string }[]
  onChange: (value: string) => void
}) {
  const id = useId()
  const readOnly = usePropertyReadOnly()
  return (
    <div className={cx(styles.weekDay, edited && formStyles.edited)}>
      <label className={styles.weekDayLabel} htmlFor={id} title={name}>
        {name.slice(0, 3)}
      </label>
      <select
        id={id}
        aria-label={name}
        className={cx(formStyles.input, styles.weekSelect)}
        value={value}
        disabled={readOnly}
        title={options.find((option) => option.value === value)?.label}
        onChange={(event) => onChange(event.target.value)}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </div>
  )
}

/** The active day type's 24 values as fields in two rows of twelve. */
function HourFields({
  day,
  saved,
  invalid,
  readOnly,
  onChange,
}: {
  day: DayDraft
  saved: Schedule['days'][number] | null
  invalid: boolean
  readOnly: boolean
  onChange: (hour: number, value: string) => void
}) {
  return (
    <fieldset className={styles.hours}>
      <legend className="visually-hidden">
        {day.name} values by hour, from 0 to 1
      </legend>
      {day.hours.map((value, hour) => {
        const edited =
          saved !== null && parse(value) !== (saved.hours[hour] ?? Number.NaN)
        return (
          <label key={hour} className={styles.hour}>
            <span className={styles.hourLabel} aria-hidden="true">
              {hour}
            </span>
            <input
              className={cx(
                formStyles.input,
                styles.hourInput,
                edited && formStyles.edited,
              )}
              inputMode="decimal"
              aria-label={`${day.name}, hour ${hour}`}
              aria-invalid={
                invalid && !valid([parse(value)]) ? true : undefined
              }
              readOnly={readOnly}
              value={value}
              onChange={(event) => onChange(hour, event.target.value)}
            />
          </label>
        )
      })}
    </fieldset>
  )
}

/**
 * The annual average as a field like the name, but read-only: an output
 * that updates, and is announced, as values change.
 */
function AnnualAverage({ value }: { value: number | null }) {
  const id = useId()
  return (
    <div className={formStyles.field}>
      <label className={formStyles.label} htmlFor={id}>
        Annual average
      </label>
      <output
        id={id}
        className={cx(formStyles.input, formStyles.readOnly, styles.average)}
        aria-live="polite"
      >
        {value === null
          ? 'Enter 0 to 1 in every hour'
          : formatNumber(value, { maxDigits: 3 })}
      </output>
    </div>
  )
}
