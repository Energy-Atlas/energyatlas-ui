import { STAGE_IDS } from '../workflow.ts'
import { ARCHETYPE_LIBRARY, DEFAULT_ARCHETYPE_IDS } from './library.ts'
import type {
  Archetype,
  Building,
  BuildingUse,
  Schedule,
  WorkbenchState,
} from '../types.ts'

// Archetype assignment and schedule statistics (jobs rollout plan, slice 5).
// An archetype matches a building by use and an optional construction-year
// range; the narrowest matching range wins, then the archetype ID, so the
// choice never depends on object order.

export function rangeWidth(archetype: Archetype): number {
  const from = archetype.yearFrom ?? 1600
  const to = archetype.yearTo ?? 2030
  return to - from
}

export function matchesBuilding(
  archetype: Archetype,
  building: Pick<Building, 'use' | 'yearBuilt'>,
): boolean {
  if (building.use !== archetype.use) return false
  if (archetype.yearFrom === null && archetype.yearTo === null) return true
  // An unknown year falls in any range open at one end; the narrowest wins.
  if (building.yearBuilt === null) {
    return archetype.yearFrom === null || archetype.yearTo === null
  }
  return (
    (archetype.yearFrom === null || building.yearBuilt >= archetype.yearFrom) &&
    (archetype.yearTo === null || building.yearBuilt <= archetype.yearTo)
  )
}

/** The archetype a building gets from the project's definitions, or null. */
export function matchArchetype(
  archetypes: Record<string, Archetype>,
  building: Pick<Building, 'use' | 'yearBuilt'>,
): string | null {
  const candidates = Object.values(archetypes)
    .filter((archetype) => matchesBuilding(archetype, building))
    .sort(
      (a, b) =>
        rangeWidth(a) - rangeWidth(b) ||
        (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
    )
  return candidates[0]?.id ?? null
}

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

export type CoverageRow = {
  use: BuildingUse | 'unknown'
  buildings: number
  assigned: number
  unassigned: number
  overridden: number
}

export type AssignmentPreview = {
  rows: CoverageRow[]
  assigned: number
  unassigned: number
  /** Buildings whose assignment would change from the current one. */
  changes: number
  /** Manual archetype overrides that win over the rules. */
  overrides: number
  /** Buildings by archetype ID after assignment. */
  byArchetype: Record<string, number>
}

/**
 * Library defaults a run adds before assigning: while Archetype modeling has
 * never run, every default archetype the project lacks, skipping names in use.
 */
export function missingDefaults(state: WorkbenchState): Archetype[] {
  const stage = state.workflow.stages[STAGE_IDS.archetypes]
  if (!stage || stage.lastRun !== null) return []
  const names = new Set(
    Object.values(state.archetypes).map((item) =>
      item.name.trim().toLowerCase(),
    ),
  )
  return ARCHETYPE_LIBRARY.filter(
    (entry) =>
      DEFAULT_ARCHETYPE_IDS.includes(entry.id) &&
      !state.archetypes[entry.id] &&
      !names.has(entry.name.trim().toLowerCase()),
  )
}

/** What assigning the current definitions would do, including defaults a first run adds; pure. */
export function previewAssignment(state: WorkbenchState): AssignmentPreview {
  const archetypes = {
    ...Object.fromEntries(
      missingDefaults(state).map((entry) => [entry.id, entry]),
    ),
    ...state.archetypes,
  }
  const rows = new Map<CoverageRow['use'], CoverageRow>()
  const byArchetype: Record<string, number> = {}
  let assigned = 0
  let unassigned = 0
  let changes = 0
  let overrides = 0
  for (const id of state.buildingIds) {
    const building = state.buildings[id]
    if (!building) continue
    const use = building.use ?? 'unknown'
    const row = rows.get(use) ?? {
      use,
      buildings: 0,
      assigned: 0,
      unassigned: 0,
      overridden: 0,
    }
    rows.set(use, row)
    row.buildings += 1
    const override = state.overrides[`${id}:archetypeId`]
    const archetypeId = override
      ? typeof override.value === 'string'
        ? override.value
        : null
      : matchArchetype(archetypes, building)
    if (override) {
      row.overridden += 1
      overrides += 1
    }
    if (archetypeId) {
      row.assigned += 1
      assigned += 1
      byArchetype[archetypeId] = (byArchetype[archetypeId] ?? 0) + 1
    } else {
      row.unassigned += 1
      unassigned += 1
    }
    if (archetypeId !== building.archetypeId) changes += 1
  }
  return {
    rows: [...rows.values()].sort((a, b) => a.use.localeCompare(b.use)),
    assigned,
    unassigned,
    changes,
    overrides,
    byArchetype,
  }
}
