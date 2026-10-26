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
  if (building.yearBuilt === null) return false
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
    .sort((a, b) => rangeWidth(a) - rangeWidth(b) || a.id.localeCompare(b.id))
  return candidates[0]?.id ?? null
}

export type ScheduleStats = {
  /** Equivalent full-load hours in a week: five weekdays and two weekend days. */
  weeklyHours: number
  /** Equivalent full-load hours in a 365-day year (52 weeks and one weekday). */
  annualHours: number
  min: number
  max: number
}

export function scheduleStats(
  schedule: Pick<Schedule, 'weekday' | 'weekend'>,
): ScheduleStats {
  const sum = (values: number[]) =>
    values.reduce((total, value) => total + value, 0)
  const weekday = sum(schedule.weekday)
  const weekend = sum(schedule.weekend)
  const weeklyHours = 5 * weekday + 2 * weekend
  const all = [...schedule.weekday, ...schedule.weekend]
  return {
    weeklyHours: Math.round(weeklyHours * 10) / 10,
    annualHours: Math.round(weeklyHours * 52 + weekday),
    min: Math.min(...all),
    max: Math.max(...all),
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

/** What assigning the current definitions would do; pure. */
export function previewAssignment(state: WorkbenchState): AssignmentPreview {
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
      : matchArchetype(state.archetypes, building)
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
