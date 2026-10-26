import { useId } from 'react'
import { scheduleStats } from '../../../domain/archetypes/assignment.ts'
import styles from './archetypes.module.css'

export type ProfileDraft = { weekday: string[]; weekend: string[] }

const HOURS = Array.from({ length: 24 }, (_, hour) => hour)

/** Parses a draft profile; values that are not numbers become NaN for the server to reject. */
export function parseProfile(values: string[]): number[] {
  return values.map((value) =>
    value.trim() === '' ? Number.NaN : Number(value),
  )
}

/**
 * A compact daily and weekly schedule editor: 24 hourly fractions for a
 * weekday and a weekend day, with bars that mirror the numbers. The numbers
 * are the accessible source; the bars are decoration.
 */
export function ScheduleEditor({
  draft,
  errors,
  onChange,
}: {
  draft: ProfileDraft
  errors: Record<string, string>
  onChange: (next: ProfileDraft) => void
}) {
  const captionId = useId()
  const numbers = {
    weekday: parseProfile(draft.weekday),
    weekend: parseProfile(draft.weekend),
  }
  const valid = [...numbers.weekday, ...numbers.weekend].every(
    (value) => Number.isFinite(value) && value >= 0 && value <= 1,
  )
  const stats = valid ? scheduleStats(numbers) : null
  return (
    <div className={styles.schedule}>
      <table className={styles.profile} aria-describedby={captionId}>
        <caption id={captionId}>
          Hourly fractions from 0 to 1. Weekdays are Monday to Friday; weekend
          days are Saturday and Sunday.
        </caption>
        <thead>
          <tr>
            <th scope="col">Day</th>
            {HOURS.map((hour) => (
              <th key={hour} scope="col">
                {hour}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {(['weekday', 'weekend'] as const).map((day) => (
            <tr key={day}>
              <th scope="row">{day === 'weekday' ? 'Weekday' : 'Weekend'}</th>
              {HOURS.map((hour) => {
                const value = numbers[day][hour] ?? 0
                return (
                  <td key={hour}>
                    <span
                      className={styles.bar}
                      style={{
                        height: `${Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0}rem`,
                      }}
                      aria-hidden="true"
                    />
                    <input
                      className={styles.hour}
                      inputMode="decimal"
                      aria-label={`${day === 'weekday' ? 'Weekday' : 'Weekend'} hour ${hour}`}
                      aria-invalid={errors[day] ? true : undefined}
                      value={draft[day][hour] ?? ''}
                      onChange={(event) => {
                        const next = [...draft[day]]
                        next[hour] = event.target.value
                        onChange({ ...draft, [day]: next })
                      }}
                    />
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
      {errors.weekday || errors.weekend ? (
        <p className={styles.error} role="alert">
          {errors.weekday ?? errors.weekend}
        </p>
      ) : null}
      <p className={styles.stats} aria-live="polite">
        {stats
          ? `${stats.weeklyHours} full-load hours a week, about ${stats.annualHours} a year; from ${stats.min} to ${stats.max}.`
          : 'Enter a number from 0 to 1 in every hour to see weekly and annual hours.'}
      </p>
    </div>
  )
}
