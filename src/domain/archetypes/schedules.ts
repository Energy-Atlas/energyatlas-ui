import type { Schedule } from '../types.ts'

// Schedule statistics (jobs rollout plan, slice 5): full-load hours from a
// schedule's day types and week.

export type ScheduleStats = {
  /** Equivalent full-load hours in a week: each day's profile, summed. */
  weeklyHours: number
  /** Equivalent full-load hours in a 365-day year (52 weeks and a Monday). */
  annualHours: number
  /**
   * The year-round average fraction: annual full-load hours over the 8,760
   * hours of the year. A constant schedule at this value gives the same
   * annual total.
   */
  annualAverage: number
  min: number
  max: number
}

const HOURS_IN_YEAR = 8760

/** The hours of the day profile a day of the week uses (0 is Monday). */
export function dayHours(
  schedule: Pick<Schedule, 'days' | 'week'>,
  weekDay: number,
): number[] {
  const id = schedule.week[weekDay]
  return schedule.days.find((day) => day.id === id)?.hours ?? []
}

/** The profile a typical working day uses: Monday's. */
export function weekdayHours(
  schedule: Pick<Schedule, 'days' | 'week'>,
): number[] {
  return dayHours(schedule, 0)
}

export function scheduleStats(
  schedule: Pick<Schedule, 'days' | 'week'>,
): ScheduleStats {
  const sum = (values: number[]) =>
    values.reduce((total, value) => total + value, 0)
  const daily = schedule.week.map((_, day) => sum(dayHours(schedule, day)))
  const weeklyHours = sum(daily)
  const annualHours = weeklyHours * 52 + (daily[0] ?? 0)
  const used = schedule.days.filter((day) => schedule.week.includes(day.id))
  const all = used.flatMap((day) => day.hours)
  return {
    weeklyHours: Math.round(weeklyHours * 10) / 10,
    annualHours: Math.round(annualHours),
    annualAverage: Math.round((annualHours / HOURS_IN_YEAR) * 1000) / 1000,
    min: all.length > 0 ? Math.min(...all) : 0,
    max: all.length > 0 ? Math.max(...all) : 0,
  }
}
