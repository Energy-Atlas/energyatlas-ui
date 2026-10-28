import type {
  Archetype,
  ArchetypePart,
  AssignedPart,
  Building,
  BuildingParts,
  ConstructionPart,
  ExternalLoadsPart,
  PartKind,
  Schedule,
  SpaceLoadsPart,
  SystemsPart,
  WorkbenchState,
} from '../types.ts'
import { PART_KINDS } from '../types.ts'
import { scheduleStats } from './schedules.ts'

// RC's four archetype parts (decision 0032) and the synthetic demand they
// give. The formula is a deterministic stand-in with fixed demo geometry, not
// a physical simulation: it only has to respond plausibly to each field.

export const PART_LABELS: Record<PartKind, string> = {
  construction: 'Construction',
  systems: 'Systems',
  spaceLoads: 'Space loads',
  externalLoads: 'External loads',
}

export function emptyParts(): BuildingParts {
  return {
    construction: null,
    systems: null,
    spaceLoads: null,
    externalLoads: null,
  }
}

export function noParts(): Record<PartKind, string | null> {
  return {
    construction: null,
    systems: null,
    spaceLoads: null,
    externalLoads: null,
  }
}

/** Facade area per m² of floor area, a fixed demo ratio. */
export const FACADE_PER_FLOOR_AREA = 0.6
/** Roof area per m² of floor area (about four storeys), a fixed demo ratio. */
export const ROOF_PER_FLOOR_AREA = 0.25
/** Storey height in m, as geospatial preprocessing uses. */
const STOREY_HEIGHT_M = 3.2
/** Heating degree hours of the synthetic Boston year, in kKh. */
const HEATING_DEGREE_KKH = 62
/** Solar gain through glazing in the cooling season, kWh per m² of glazing. */
const SOLAR_GAIN_KWH_PER_M2 = 70
/** Heat from one occupant, W. */
const PERSON_W = 80
/** Full-load hours of a space-loads part without a schedule: a flat half load. */
export const UNSCHEDULED_HOURS = 4380

/** Delivered energy per m² of floor area a year, by end use. */
export type IntensityBreakdown = {
  heating: number
  cooling: number
  hotWater: number
  lighting: number
  equipment: number
  exterior: number
  process: number
  total: number
}

export type PartSet = {
  construction: ConstructionPart
  systems: SystemsPart
  spaceLoads: SpaceLoadsPart
  externalLoads: ExternalLoadsPart
}

function round1(value: number): number {
  return Math.round(value * 10) / 10
}

/** Full-load hours a space-loads part runs a year. */
export function loadHours(
  spaceLoads: SpaceLoadsPart,
  schedules: Record<string, Schedule>,
): number {
  const schedule = spaceLoads.scheduleId
    ? schedules[spaceLoads.scheduleId]
    : undefined
  return schedule ? scheduleStats(schedule).annualHours : UNSCHEDULED_HOURS
}

/**
 * The synthetic energy use intensity of four parts, kWh/m² a year:
 *
 * - heat loss H = facade × ((1 − window ratio) × wall U + window ratio ×
 *   window U) + roof × roof U + 0.34 × air changes × storey height (W/m²K);
 * - internal gains from lighting, equipment, and people over the schedule's
 *   full-load hours; heating need = H × degree hours − 30% of gains;
 *   cooling need = 35% of gains + solar gain through the glazing;
 * - delivered = heating and hot water over the heating efficiency, cooling
 *   over the COP, plus lighting, equipment, and external loads.
 */
export function partsIntensity(
  parts: PartSet,
  schedules: Record<string, Schedule>,
): IntensityBreakdown {
  const { construction, systems, spaceLoads, externalLoads } = parts
  const hours = loadHours(spaceLoads, schedules)
  const lighting = (spaceLoads.lightingWPerM2 * hours) / 1000
  const equipment = (spaceLoads.equipmentWPerM2 * hours) / 1000
  const people = ((PERSON_W / spaceLoads.m2PerPerson) * hours) / 1000
  const gains = lighting + equipment + people
  const lossCoefficient =
    FACADE_PER_FLOOR_AREA *
      ((1 - construction.windowRatio) * construction.wallU +
        construction.windowRatio * construction.windowU) +
    ROOF_PER_FLOOR_AREA * construction.roofU +
    0.34 * construction.infiltrationAch * STOREY_HEIGHT_M
  const heatingNeed = Math.max(
    0,
    lossCoefficient * HEATING_DEGREE_KKH - 0.3 * gains,
  )
  const coolingNeed =
    0.35 * gains +
    construction.windowRatio * FACADE_PER_FLOOR_AREA * SOLAR_GAIN_KWH_PER_M2
  const heating = heatingNeed / systems.heatingEfficiency
  const cooling = coolingNeed / systems.coolingCop
  const hotWater = systems.hotWaterKwhPerM2 / systems.heatingEfficiency
  const exterior = externalLoads.exteriorLightingKwhPerM2
  const process = externalLoads.processKwhPerM2
  const total =
    heating + cooling + hotWater + lighting + equipment + exterior + process
  return {
    heating: round1(heating),
    cooling: round1(cooling),
    hotWater: round1(hotWater),
    lighting: round1(lighting),
    equipment: round1(equipment),
    exterior: round1(exterior),
    process: round1(process),
    total: round1(total),
  }
}

/** The four parts by id, or null when one is unset or missing. */
export function resolveParts(
  ids: Record<PartKind, string | null>,
  parts: Record<string, ArchetypePart>,
): PartSet | null {
  const construction = ids.construction ? parts[ids.construction] : undefined
  const systems = ids.systems ? parts[ids.systems] : undefined
  const spaceLoads = ids.spaceLoads ? parts[ids.spaceLoads] : undefined
  const externalLoads = ids.externalLoads ? parts[ids.externalLoads] : undefined
  if (
    construction?.kind !== 'construction' ||
    systems?.kind !== 'systems' ||
    spaceLoads?.kind !== 'spaceLoads' ||
    externalLoads?.kind !== 'externalLoads'
  ) {
    return null
  }
  return { construction, systems, spaceLoads, externalLoads }
}

/** Where a building's part comes from now: a manual override or a rule. */
export type EffectivePart =
  | { partId: string; via: 'manual'; operationId: string }
  | { partId: string; via: 'rule'; ruleId: string; ruleName: string }

export function overrideKey(buildingId: string, kind: PartKind): string {
  return `${buildingId}:${kind}`
}

/** A building's parts as they apply: manual overrides win over published rule results. */
export function effectiveParts(
  state: Pick<WorkbenchState, 'overrides'>,
  building: Pick<Building, 'id' | 'parts'>,
): Record<PartKind, EffectivePart | null> {
  const result = {} as Record<PartKind, EffectivePart | null>
  for (const kind of PART_KINDS) {
    const override = state.overrides[overrideKey(building.id, kind)]
    const published: AssignedPart | null = building.parts[kind]
    result[kind] =
      override && typeof override.value === 'string'
        ? {
            partId: override.value,
            via: 'manual',
            operationId: override.operationId,
          }
        : published
          ? { via: 'rule', ...published }
          : null
  }
  return result
}

export function effectivePartIds(
  state: Pick<WorkbenchState, 'overrides'>,
  building: Pick<Building, 'id' | 'parts'>,
): Record<PartKind, string | null> {
  const effective = effectiveParts(state, building)
  return Object.fromEntries(
    PART_KINDS.map((kind) => [kind, effective[kind]?.partId ?? null]),
  ) as Record<PartKind, string | null>
}

/** A building's synthetic intensity from its effective parts, or null when one is missing. */
export function buildingIntensity(
  state: Pick<WorkbenchState, 'overrides' | 'parts' | 'schedules'>,
  building: Pick<Building, 'id' | 'parts'>,
): IntensityBreakdown | null {
  const set = resolveParts(effectivePartIds(state, building), state.parts)
  return set ? partsIntensity(set, state.schedules) : null
}

/** An archetype's intensity when all four of its parts exist. */
export function archetypeIntensity(
  archetype: Pick<Archetype, 'parts'>,
  parts: Record<string, ArchetypePart>,
  schedules: Record<string, Schedule>,
): IntensityBreakdown | null {
  const set = resolveParts(archetype.parts, parts)
  return set ? partsIntensity(set, schedules) : null
}

/**
 * What to call a building's combination of parts: the archetype bundling
 * exactly those four, "Mixed parts" for any other complete set, or null
 * while a part is missing.
 */
export function archetypeLabel(
  state: Pick<WorkbenchState, 'overrides' | 'archetypes'>,
  building: Pick<Building, 'id' | 'parts'>,
): string | null {
  const ids = effectivePartIds(state, building)
  if (PART_KINDS.some((kind) => ids[kind] === null)) return null
  const archetype = Object.values(state.archetypes).find((candidate) =>
    PART_KINDS.every((kind) => candidate.parts[kind] === ids[kind]),
  )
  return archetype?.name ?? 'Mixed parts'
}

/** The schedule a building's space loads follow, or null. */
export function buildingSchedule(
  state: Pick<WorkbenchState, 'overrides' | 'parts' | 'schedules'>,
  building: Pick<Building, 'id' | 'parts'>,
): Schedule | null {
  const id = effectivePartIds(state, building).spaceLoads
  const part = id ? state.parts[id] : undefined
  if (part?.kind !== 'spaceLoads' || !part.scheduleId) return null
  return state.schedules[part.scheduleId] ?? null
}

/** A short summary of a part's values, for tables. */
export function partSummary(
  part: ArchetypePart,
  schedules: Record<string, Pick<Schedule, 'name'>>,
): string {
  switch (part.kind) {
    case 'construction':
      return `Wall U ${part.wallU}, roof U ${part.roofU}, window U ${part.windowU}, ${Math.round(part.windowRatio * 100)}% glazed, ${part.infiltrationAch} ACH`
    case 'systems':
      return `${FUEL_LABELS[part.fuel]}, heating ${part.heatingEfficiency}, cooling COP ${part.coolingCop}, hot water ${part.hotWaterKwhPerM2} kWh/m²`
    case 'spaceLoads':
      return `Lighting ${part.lightingWPerM2} W/m², equipment ${part.equipmentWPerM2} W/m², ${part.m2PerPerson} m²/person, ${part.scheduleId ? (schedules[part.scheduleId]?.name ?? part.scheduleId) : 'no schedule'}`
    case 'externalLoads':
      return `Exterior lighting ${part.exteriorLightingKwhPerM2} kWh/m², process ${part.processKwhPerM2} kWh/m²`
  }
}

export const FUEL_LABELS: Record<SystemsPart['fuel'], string> = {
  gas: 'Gas',
  electric: 'Electric',
  district: 'District heat',
}
