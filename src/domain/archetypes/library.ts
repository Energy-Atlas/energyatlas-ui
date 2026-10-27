import type { Archetype, Schedule } from '../types.ts'

// The synthetic archetype and schedule library (jobs rollout plan, slice 5).
// Values are illustrative stand-ins, not RC's library or any standard's
// tables; nothing here describes real buildings.

function profile(hours: [number, number][], base = 0.05): number[] {
  const values = Array.from({ length: 24 }, () => base)
  for (const [hour, value] of hours) values[hour] = value
  return values
}

function span(from: number, to: number, value: number): [number, number][] {
  return Array.from({ length: to - from }, (_, index) => [from + index, value])
}

/**
 * The days and week of a schedule with one profile for Monday to Friday and
 * another for Saturday and Sunday, the shape most library schedules share.
 */
export function weekdayWeekend(
  weekday: number[],
  weekend: number[],
): Pick<Schedule, 'days' | 'week'> {
  return {
    days: [
      { id: 'weekday', name: 'Weekday', hours: weekday },
      { id: 'weekend', name: 'Weekend', hours: weekend },
    ],
    week: [
      'weekday',
      'weekday',
      'weekday',
      'weekday',
      'weekday',
      'weekend',
      'weekend',
    ],
  }
}

export const SCHEDULE_LIBRARY: readonly Schedule[] = [
  {
    id: 'schedule:office',
    name: 'Office occupancy',
    ...weekdayWeekend(
      profile([...span(7, 8, 0.3), ...span(8, 17, 0.95), ...span(17, 19, 0.4)]),
      profile(span(9, 13, 0.15)),
    ),
    source: { kind: 'library', libraryId: 'schedule:office' },
  },
  {
    id: 'schedule:residential',
    name: 'Residential occupancy',
    ...weekdayWeekend(
      profile(
        [
          ...span(0, 7, 0.9),
          ...span(7, 9, 0.6),
          ...span(9, 17, 0.3),
          ...span(17, 24, 0.85),
        ],
        0.3,
      ),
      profile([...span(0, 10, 0.9), ...span(10, 24, 0.7)], 0.7),
    ),
    source: { kind: 'library', libraryId: 'schedule:residential' },
  },
  {
    id: 'schedule:retail',
    name: 'Retail opening hours',
    // Shops keep shorter hours on Sunday than on Saturday.
    days: [
      { id: 'weekday', name: 'Weekday', hours: profile(span(10, 20, 0.85)) },
      { id: 'saturday', name: 'Saturday', hours: profile(span(10, 18, 0.95)) },
      { id: 'sunday', name: 'Sunday', hours: profile(span(11, 17, 0.7)) },
    ],
    week: [
      'weekday',
      'weekday',
      'weekday',
      'weekday',
      'weekday',
      'saturday',
      'sunday',
    ],
    source: { kind: 'library', libraryId: 'schedule:retail' },
  },
  {
    id: 'schedule:school',
    name: 'School day',
    ...weekdayWeekend(
      profile([...span(8, 15, 0.95), ...span(15, 17, 0.3)]),
      profile([], 0.02),
    ),
    source: { kind: 'library', libraryId: 'schedule:school' },
  },
]

/** The library; the first five are the defaults Archetype modeling starts from. */
export const ARCHETYPE_LIBRARY: readonly Archetype[] = [
  {
    id: 'archetype:residential-pre-1980',
    name: 'Residential, built before 1980',
    use: 'residential',
    yearFrom: null,
    yearTo: 1979,
    euiKwhPerM2: 165,
    scheduleId: 'schedule:residential',
    source: { kind: 'library', libraryId: 'archetype:residential-pre-1980' },
  },
  {
    id: 'archetype:residential-1980-on',
    name: 'Residential, built 1980 or later',
    use: 'residential',
    yearFrom: 1980,
    yearTo: null,
    euiKwhPerM2: 115,
    scheduleId: 'schedule:residential',
    source: { kind: 'library', libraryId: 'archetype:residential-1980-on' },
  },
  {
    id: 'archetype:office',
    name: 'Office',
    use: 'office',
    yearFrom: null,
    yearTo: null,
    euiKwhPerM2: 210,
    scheduleId: 'schedule:office',
    source: { kind: 'library', libraryId: 'archetype:office' },
  },
  {
    id: 'archetype:retail',
    name: 'Retail',
    use: 'retail',
    yearFrom: null,
    yearTo: null,
    euiKwhPerM2: 240,
    scheduleId: 'schedule:retail',
    source: { kind: 'library', libraryId: 'archetype:retail' },
  },
  {
    id: 'archetype:school',
    name: 'School',
    use: 'school',
    yearFrom: null,
    yearTo: null,
    euiKwhPerM2: 140,
    scheduleId: 'schedule:school',
    source: { kind: 'library', libraryId: 'archetype:school' },
  },
  {
    id: 'archetype:mixed',
    name: 'Mixed use',
    use: 'mixed',
    yearFrom: null,
    yearTo: null,
    euiKwhPerM2: 185,
    scheduleId: 'schedule:office',
    source: { kind: 'library', libraryId: 'archetype:mixed' },
  },
  {
    id: 'archetype:office-pre-1950',
    name: 'Office, built before 1950',
    use: 'office',
    yearFrom: null,
    yearTo: 1949,
    euiKwhPerM2: 255,
    scheduleId: 'schedule:office',
    source: { kind: 'library', libraryId: 'archetype:office-pre-1950' },
  },
]

export const DEFAULT_ARCHETYPE_IDS = ARCHETYPE_LIBRARY.slice(0, 5).map(
  (archetype) => archetype.id,
)
