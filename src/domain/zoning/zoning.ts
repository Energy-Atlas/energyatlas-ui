import type { Building, LngLat, WorkbenchState } from '../types.ts'
import {
  area,
  cleanRing,
  facingOf,
  groupEdges,
  insetRing,
  perimeterCells,
  type Facing,
  type InsetFailure,
  type Point,
} from './geometry.ts'

// Floors and zones (decision 0032, stage 6). The zoning setting follows RC's
// three modes (EnergyAtlasLib/Factory/Zoning.cs, ThermalZoningPolicy.cs): one
// zone per building, one per floor, or a core and perimeter zones on every
// floor. Floors are uniform: floor height is the building's height over its
// storeys (ThermalZoningPolicy.cs:39-51). Floors and zones are derived from
// the building and the zoning the last Geospatial preprocessing run applied;
// they are never stored.

export type ZoningMode = 'single' | 'floors' | 'perimeterCore'

export const ZONING_MODES = [
  'single',
  'floors',
  'perimeterCore',
] as const satisfies readonly ZoningMode[]

export const ZONING_MODE_LABELS: Record<ZoningMode, string> = {
  single: 'One zone per building',
  floors: 'One zone per floor',
  perimeterCore: 'Perimeter and core per floor',
}

/** RC's names for the modes, as its run input spells them. */
export const RC_ZONING_MODES: Record<ZoningMode, string> = {
  single: 'Single',
  floors: 'Floors',
  perimeterCore: 'PerimeterCore',
}

export type ZoningSetting = {
  mode: ZoningMode
  /** Depth of the perimeter band in metres; used by perimeterCore only. */
  perimeterDepthM: number
}

/** The zoning a Geospatial preprocessing run applied. */
export type PublishedZoning = ZoningSetting & { runId: string }

export type ZoningState = ZoningSetting & {
  /**
   * What the last successful Geospatial preprocessing run zoned by; null
   * before one has run, and for projects saved before zoning settings.
   */
  published: PublishedZoning | null
}

/** RC's run without zoning forms one zone per building (SimulationController.cs:585-598). */
export const DEFAULT_ZONING_MODE: ZoningMode = 'single'
/** A 4.5 m band, about 15 ft, as RC's zoned formation test uses (ZonedFormationTests.cs:52). */
export const DEFAULT_PERIMETER_DEPTH_M = 4.5
export const MIN_PERIMETER_DEPTH_M = 1
export const MAX_PERIMETER_DEPTH_M = 15
/** A core smaller than this many square metres falls back to one zone per floor. */
export const MIN_CORE_AREA_M2 = 10
/** A core smaller than this share of the floor falls back too. */
export const MIN_CORE_SHARE = 0.1

export function initialZoning(): ZoningState {
  return {
    mode: DEFAULT_ZONING_MODE,
    perimeterDepthM: DEFAULT_PERIMETER_DEPTH_M,
    published: null,
  }
}

export function describeZoning(setting: ZoningSetting): string {
  return setting.mode === 'perimeterCore'
    ? `${ZONING_MODE_LABELS.perimeterCore}, ${formatDepth(setting.perimeterDepthM)} deep`
    : ZONING_MODE_LABELS[setting.mode]
}

function formatDepth(depth: number): string {
  return `${depth.toLocaleString('en-US', { maximumFractionDigits: 1 })} m`
}

export function sameZoning(a: ZoningSetting, b: ZoningSetting): boolean {
  return (
    a.mode === b.mode &&
    (a.mode !== 'perimeterCore' || a.perimeterDepthM === b.perimeterDepthM)
  )
}

/** Whole building, whole floor, perimeter, or core. */
export type ZoneKind = 'building' | 'floor' | 'perimeter' | 'core'

export const ZONE_KIND_LABELS: Record<ZoneKind, string> = {
  building: 'Whole building',
  floor: 'Whole floor',
  perimeter: 'Perimeter',
  core: 'Core',
}

export type Floor = {
  /** `<building>:F<n>`, counted from 1 at the ground. */
  id: string
  buildingId: string
  number: number
  bottomM: number
  topM: number
  areaM2: number
  /** Zones on this floor; the whole-building zone counts on every floor. */
  zoneIds: string[]
}

export type Zone = {
  /** Positional, as RC's (DeterministicIds.cs:22): `<building>:Z1`, or `<building>:F<n>:Z<k>` with the core first. */
  id: string
  buildingId: string
  name: string
  kind: ZoneKind
  /** Null for the whole-building zone. */
  floor: number | null
  bottomM: number
  topM: number
  /** Floor area of the zone, over every floor it spans. */
  areaM2: number
  /** The outward direction a perimeter zone faces. */
  facing: Facing | null
  /** The zone's plan, a closed ring in longitude and latitude. */
  plan: LngLat[]
  /**
   * Which colour the zone takes: 0 to 2 for the categorical slots, chosen so
   * neighbouring zones differ; null for the core (the de-emphasis colour).
   */
  colorSlot: number | null
}

export type ZoningFallbackCode =
  'footprint_not_simple' | 'perimeter_inset_failed' | 'core_too_small'

/** Why perimeter-and-core zoning fell back to one zone per floor. */
export type ZoningFallback = {
  code: ZoningFallbackCode
  message: string
}

export type BuildingZoning = {
  buildingId: string
  /** The setting asked for. */
  setting: ZoningSetting
  /** What the building got: perimeterCore can fall back to floors. */
  appliedMode: ZoningMode
  floorHeightM: number
  floors: Floor[]
  zones: Zone[]
  fallback: ZoningFallback | null
}

const METERS_PER_DEGREE = 111_320

/** A local plane in metres around the ring's first point, as `ringAreaM2` uses. */
function planeOf(ring: LngLat[]) {
  const [originLng, originLat] = ring[0] ?? [0, 0]
  const metersPerLng = METERS_PER_DEGREE * Math.cos((originLat * Math.PI) / 180)
  return {
    toPlane: ([lng, lat]: LngLat): Point => [
      (lng - originLng) * metersPerLng,
      (lat - originLat) * METERS_PER_DEGREE,
    ],
    toLngLat: ([x, y]: Point): LngLat => [
      originLng + x / metersPerLng,
      originLat + y / METERS_PER_DEGREE,
    ],
  }
}

function round(value: number, digits = 2): number {
  const factor = 10 ** digits
  return Math.round(value * factor) / factor
}

const FAILURE_MESSAGES: Record<InsetFailure, string> = {
  not_simple:
    'the footprint touches or crosses itself, so it has no inset core',
  edge_collapsed:
    'the footprint is too narrow somewhere for the perimeter depth, so its inset collapses',
  core_crosses_perimeter:
    'a concave part of the footprint is narrower than twice the perimeter depth',
  core_outside: 'the inset leaves the footprint',
}

type PlanZone = {
  kind: 'core' | 'perimeter'
  ring: Point[]
  facing: Facing | null
}

/**
 * One floor's perimeter-and-core plan, core first then perimeter zones in
 * footprint order, or why there is none.
 */
export function perimeterCorePlan(
  footprint: Point[],
  depth: number,
): { zones: PlanZone[] } | { fallback: ZoningFallback } {
  const ring = cleanRing(footprint)
  if (!ring) {
    return {
      fallback: {
        code: 'footprint_not_simple',
        message: 'The footprint has fewer than three distinct corners.',
      },
    }
  }
  const inset = insetRing(ring, depth)
  if (!inset.ok) {
    return {
      fallback: {
        code:
          inset.failure === 'not_simple'
            ? 'footprint_not_simple'
            : 'perimeter_inset_failed',
        message: `Perimeter and core fell back to one zone per floor: ${FAILURE_MESSAGES[inset.failure]}.`,
      },
    }
  }
  const footprintArea = area(ring)
  const coreArea = area(inset.core)
  if (
    coreArea < MIN_CORE_AREA_M2 ||
    coreArea < footprintArea * MIN_CORE_SHARE
  ) {
    return {
      fallback: {
        code: 'core_too_small',
        message: `Perimeter and core fell back to one zone per floor: a ${formatDepth(depth)} perimeter leaves a core of ${Math.round(coreArea).toLocaleString('en-US')} m², less than ${MIN_CORE_AREA_M2} m² or ${MIN_CORE_SHARE * 100}% of the floor.`,
      },
    }
  }
  // Edges shorter than the depth join the zone of the edge before them, so
  // short jogs in OpenStreetMap outlines do not become slivers.
  const groups = groupEdges(ring, depth)
  const cells = perimeterCells(ring, inset.core, groups)
  const covered = cells.reduce((sum, cell) => sum + area(cell), coreArea)
  // Every zone together must cover the floor, as RC's VerifyCoverage checks.
  if (Math.abs(covered - footprintArea) > footprintArea * 0.005) {
    return {
      fallback: {
        code: 'perimeter_inset_failed',
        message:
          'Perimeter and core fell back to one zone per floor: the zones did not cover the floor exactly.',
      },
    }
  }
  return {
    zones: [
      { kind: 'core', ring: inset.core, facing: null },
      ...cells.map((cell, index): PlanZone => {
        const edges = groups[index] ?? []
        // A group faces where its longest edge faces.
        let longest = edges[0] ?? 0
        let best = -1
        for (const edge of edges) {
          const a = ring[edge] ?? [0, 0]
          const b = ring[(edge + 1) % ring.length] ?? a
          const length = Math.hypot(b[0] - a[0], b[1] - a[1])
          if (length > best) {
            best = length
            longest = edge
          }
        }
        const a = ring[longest] ?? [0, 0]
        const b = ring[(longest + 1) % ring.length] ?? a
        return { kind: 'perimeter', ring: cell, facing: facingOf(a, b) }
      }),
    ],
  }
}

/** Categorical slots around a ring of `count` neighbours, never repeating next door. */
function ringSlots(count: number): number[] {
  const slots = Array.from({ length: count }, (_, index) => index % 3)
  // With one left over, the last would match the first.
  if (count > 1 && count % 3 === 1) slots[count - 1] = 1
  return slots
}

function closed(ring: LngLat[]): LngLat[] {
  const first = ring[0]
  return first ? [...ring, first] : ring
}

const cache = new WeakMap<Building, Map<string, BuildingZoning | null>>()

/**
 * A building's floors and zones under a zoning setting, or null when it has
 * no height or floor count yet (before Geospatial preprocessing).
 */
export function zoneBuilding(
  building: Building,
  setting: ZoningSetting,
): BuildingZoning | null {
  const key = `${setting.mode}:${setting.perimeterDepthM}`
  let byBuilding = cache.get(building)
  if (!byBuilding) {
    byBuilding = new Map()
    cache.set(building, byBuilding)
  }
  if (byBuilding.has(key)) return byBuilding.get(key) ?? null
  const zoning = computeZoning(building, setting)
  byBuilding.set(key, zoning)
  return zoning
}

function computeZoning(
  building: Building,
  setting: ZoningSetting,
): BuildingZoning | null {
  const storeys = building.floors
  const height = building.heightM
  if (storeys === null || height === null || storeys < 1 || !(height > 0)) {
    return null
  }
  const count = Math.round(storeys)
  const floorHeight = height / count
  const floorArea = building.footprintAreaM2
  const id = building.id
  const floors: Floor[] = Array.from({ length: count }, (_, index) => ({
    id: `${id}:F${index + 1}`,
    buildingId: id,
    number: index + 1,
    bottomM: round(index * floorHeight),
    topM: round((index + 1) * floorHeight),
    areaM2: round(floorArea),
    zoneIds: [],
  }))
  const outline = closed(
    building.footprint.length > 1 &&
      building.footprint[0]?.[0] === building.footprint.at(-1)?.[0] &&
      building.footprint[0]?.[1] === building.footprint.at(-1)?.[1]
      ? building.footprint.slice(0, -1)
      : building.footprint,
  )
  const zones: Zone[] = []
  let appliedMode = setting.mode
  let fallback: ZoningFallback | null = null

  let plan: PlanZone[] | null = null
  let plane: ReturnType<typeof planeOf> | null = null
  if (setting.mode === 'perimeterCore') {
    plane = planeOf(building.footprint)
    const result = perimeterCorePlan(
      building.footprint.map(plane.toPlane),
      setting.perimeterDepthM,
    )
    if ('fallback' in result) {
      fallback = result.fallback
      appliedMode = 'floors'
    } else {
      plan = result.zones
    }
  }

  if (appliedMode === 'single') {
    const zoneId = `${id}:Z1`
    zones.push({
      id: zoneId,
      buildingId: id,
      name: 'Whole building',
      kind: 'building',
      floor: null,
      bottomM: 0,
      topM: round(height),
      areaM2: round(floorArea * count),
      facing: null,
      plan: outline,
      colorSlot: 0,
    })
    for (const floor of floors) floor.zoneIds.push(zoneId)
  } else if (appliedMode === 'floors' || !plan || !plane) {
    const slots = Array.from({ length: count }, (_, index) => index % 3)
    for (const floor of floors) {
      const zoneId = `${floor.id}:Z1`
      zones.push({
        id: zoneId,
        buildingId: id,
        name: `Floor ${floor.number}`,
        kind: 'floor',
        floor: floor.number,
        bottomM: floor.bottomM,
        topM: floor.topM,
        areaM2: floor.areaM2,
        facing: null,
        plan: outline,
        colorSlot: slots[floor.number - 1] ?? 0,
      })
      floor.zoneIds.push(zoneId)
    }
  } else {
    // Plan areas are scaled so a floor's zones add up to the footprint area
    // exactly (the core and perimeter share the plane `ringAreaM2` uses).
    const planArea = plan.reduce((sum, zone) => sum + area(zone.ring), 0)
    const scale = planArea > 0 ? floorArea / planArea : 1
    const perimeterSlots = ringSlots(plan.length - 1)
    const toLngLat = plane.toLngLat
    for (const floor of floors) {
      plan.forEach((zone, index) => {
        const zoneId = `${floor.id}:Z${index + 1}`
        const facing = zone.facing
        zones.push({
          id: zoneId,
          buildingId: id,
          name:
            zone.kind === 'core'
              ? `Floor ${floor.number} core`
              : `Floor ${floor.number} perimeter ${index}${facing ? ` (${facing})` : ''}`,
          kind: zone.kind,
          floor: floor.number,
          bottomM: floor.bottomM,
          topM: floor.topM,
          areaM2: round(area(zone.ring) * scale),
          facing,
          plan: closed(zone.ring.map(toLngLat)),
          colorSlot:
            zone.kind === 'core' ? null : (perimeterSlots[index - 1] ?? 0),
        })
        floor.zoneIds.push(zoneId)
      })
    }
  }
  return {
    buildingId: id,
    setting,
    appliedMode,
    floorHeightM: round(floorHeight),
    floors,
    zones,
    fallback,
  }
}

/** The zoning the project's floors and zones follow: the last published one. */
export function publishedZoning(
  state: Pick<WorkbenchState, 'zoning'>,
): PublishedZoning | null {
  return state.zoning.published
}

/** A building's floors and zones as the last Geospatial preprocessing run zoned it. */
export function buildingZoning(
  state: Pick<WorkbenchState, 'zoning' | 'buildings'>,
  buildingId: string,
): BuildingZoning | null {
  const building = state.buildings[buildingId]
  const published = state.zoning.published
  if (!building || !published) return null
  return zoneBuilding(building, published)
}

/**
 * A building's floors, whether or not zones were published: floors follow
 * its storeys and height alone.
 */
export function buildingFloors(
  state: Pick<WorkbenchState, 'zoning' | 'buildings'>,
  buildingId: string,
): Floor[] {
  const building = state.buildings[buildingId]
  if (!building) return []
  const zoning = zoneBuilding(
    building,
    state.zoning.published ?? { mode: 'single', perimeterDepthM: 0 },
  )
  return zoning?.floors ?? []
}

/** The building a floor or zone id belongs to. */
export function ownerOf(id: string): string {
  const index = id.indexOf(':')
  return index === -1 ? id : id.slice(0, index)
}

/** Whether a floor id exists in the project. */
export function floorExists(
  state: Pick<WorkbenchState, 'zoning' | 'buildings'>,
  id: string,
): boolean {
  return buildingFloors(state, ownerOf(id)).some((floor) => floor.id === id)
}

/** Whether a zone id exists in the published zoning. */
export function zoneExists(
  state: Pick<WorkbenchState, 'zoning' | 'buildings'>,
  id: string,
): boolean {
  return (
    buildingZoning(state, ownerOf(id))?.zones.some((zone) => zone.id === id) ??
    false
  )
}

/** The buildings a selection of buildings, floors, or zones is about. */
export function selectedBuildingIds(
  selection: WorkbenchState['selection'],
): string[] {
  if (selection.entityType === 'building') return selection.ids
  if (selection.entityType === 'floor' || selection.entityType === 'zone') {
    return [...new Set(selection.ids.map(ownerOf))]
  }
  return []
}

/** How many zones a building gets under a setting, as preprocessing publishes. */
export function zoneCountFor(
  building: Building,
  setting: ZoningSetting,
): number | null {
  return zoneBuilding(building, setting)?.zones.length ?? null
}

/** Fallbacks by code over the given buildings, for preprocessing's warnings. */
export function zoningFallbacks(
  buildings: Building[],
  setting: ZoningSetting,
): Map<ZoningFallbackCode, string[]> {
  const byCode = new Map<ZoningFallbackCode, string[]>()
  if (setting.mode !== 'perimeterCore') return byCode
  for (const building of buildings) {
    const fallback = zoneBuilding(building, setting)?.fallback
    if (!fallback) continue
    const list = byCode.get(fallback.code) ?? []
    list.push(building.id)
    byCode.set(fallback.code, list)
  }
  return byCode
}

const FALLBACK_SUMMARIES: Record<ZoningFallbackCode, string> = {
  footprint_not_simple: 'their footprints touch or cross themselves',
  perimeter_inset_failed:
    'their footprints are too narrow somewhere for the perimeter depth',
  core_too_small: 'the core would be too small',
}

/**
 * RC-style coded warnings for buildings zoned one zone per floor instead of
 * perimeter and core.
 */
export function fallbackWarnings(
  byCode: Map<ZoningFallbackCode, string[]>,
): { code: ZoningFallbackCode; buildingIds: string[]; message: string }[] {
  return [...byCode].map(([code, ids]) => ({
    code,
    buildingIds: ids,
    message: `${code}: ${ids.length} building${ids.length === 1 ? ' was' : 's were'} zoned one zone per floor instead of perimeter and core because ${FALLBACK_SUMMARIES[code]} (${ids.slice(0, 5).join(', ')}${ids.length > 5 ? `, and ${ids.length - 5} more` : ''}).`,
  }))
}

/**
 * The synthetic split of a building's demand over its floors and zones, by
 * floor-area share; the shares add up to the building's total exactly.
 */
export function demandShares(
  zoning: BuildingZoning,
  buildingKwh: number,
): { floors: Record<string, number>; zones: Record<string, number> } {
  const total = zoning.zones.reduce((sum, zone) => sum + zone.areaM2, 0)
  const zones: Record<string, number> = {}
  for (const zone of zoning.zones) {
    zones[zone.id] = total > 0 ? (buildingKwh * zone.areaM2) / total : 0
  }
  const floors: Record<string, number> = {}
  for (const floor of zoning.floors) {
    floors[floor.id] = buildingKwh / Math.max(1, zoning.floors.length)
  }
  return { floors, zones }
}
