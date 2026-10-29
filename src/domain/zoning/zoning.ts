import type { Building, LngLat, WorkbenchState } from '../types.ts'
import {
  DRAWN_ZONE_USE_LABELS,
  drawnColorSlots,
  drawnPlanProblem,
  type DrawnFallbackCode,
  type DrawnZoneUse,
  type DrawnZoning,
  type PlanePlan,
} from './drawn.ts'
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

/**
 * How one building is zoned (decision 0034): the project's three modes, or
 * the building's own drawn zones.
 */
export type BuildingZoningMode = ZoningMode | 'drawn'

export const BUILDING_ZONING_MODES = [
  'single',
  'floors',
  'perimeterCore',
  'drawn',
] as const satisfies readonly BuildingZoningMode[]

/** A building's choice in Properties: the project default or its own mode. */
export type BuildingZoningChoice = 'default' | BuildingZoningMode

export const BUILDING_ZONING_CHOICES = [
  'default',
  ...BUILDING_ZONING_MODES,
] as const satisfies readonly BuildingZoningChoice[]

/** The labels a building's zoning control uses (decision 0034). */
export const BUILDING_ZONING_LABELS: Record<BuildingZoningMode, string> = {
  single: 'One zone',
  floors: 'Each floor a zone',
  perimeterCore: 'Perimeter and core per floor',
  drawn: 'Drawn zones',
}

export type BuildingZoningSetting = {
  mode: BuildingZoningMode
  perimeterDepthM: number
}

/** Where a building's zoning comes from: the project's setting or its own override. */
export type ZoningSource = 'default' | 'override'

export const ZONING_SOURCE_LABELS: Record<ZoningSource, string> = {
  default: 'Project default',
  override: 'Building override',
}

/**
 * The zoning a Geospatial preprocessing run applied, with the storeys each
 * building had then: floors are sliced from those, not from a floor count
 * edited since, until the stage runs again.
 */
export type PublishedZoning = ZoningSetting & {
  runId: string
  storeys: Record<string, number>
  /** The building overrides the run applied (decision 0034); none before them. */
  overrides: Record<string, BuildingZoningMode>
}

export type ZoningState = ZoningSetting & {
  /**
   * Buildings zoned their own way instead of the project's mode, by building
   * id (decision 0034).
   */
  overrides: Record<string, BuildingZoningMode>
  /**
   * Drawn zone outlines by building id (decision 0034): synthetic,
   * hand-authored, stored with the project; nothing edits them yet.
   */
  drawn: Record<string, DrawnZoning>
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
    overrides: {},
    drawn: {},
    published: null,
  }
}

export function describeZoning(setting: ZoningSetting): string {
  return setting.mode === 'perimeterCore'
    ? `${ZONING_MODE_LABELS.perimeterCore}, ${formatDepth(setting.perimeterDepthM)} deep`
    : ZONING_MODE_LABELS[setting.mode]
}

/** One building's zoning in words, with the label its control uses. */
export function describeBuildingZoning(setting: BuildingZoningSetting): string {
  return setting.mode === 'perimeterCore'
    ? `${BUILDING_ZONING_LABELS.perimeterCore}, ${formatDepth(setting.perimeterDepthM)} deep`
    : BUILDING_ZONING_LABELS[setting.mode]
}

/**
 * How a building was zoned, in words: what it got and, when it fell back,
 * what it asked for (decision 0034).
 */
export function describeAppliedZoning(
  zoning: Pick<BuildingZoning, 'appliedMode' | 'setting' | 'fallback'>,
): string {
  const got = describeBuildingZoning({
    mode: zoning.appliedMode,
    perimeterDepthM: zoning.setting.perimeterDepthM,
  })
  return zoning.fallback
    ? `${got}, falling back from ${describeBuildingZoning(zoning.setting).toLowerCase()}`
    : got
}

/**
 * How a building is zoned under a project setting with overrides: its own
 * mode when it has one, else the project's, with the project's depth.
 */
export function resolveBuildingZoning(
  zoning: ZoningSetting & { overrides?: Record<string, BuildingZoningMode> },
  buildingId: string,
): BuildingZoningSetting & { source: ZoningSource } {
  const override = zoning.overrides?.[buildingId]
  return {
    mode: override ?? zoning.mode,
    perimeterDepthM: zoning.perimeterDepthM,
    source: override === undefined ? 'default' : 'override',
  }
}

/** Whether two building settings give the same zones. */
export function sameBuildingZoning(
  a: BuildingZoningSetting,
  b: BuildingZoningSetting,
): boolean {
  return (
    a.mode === b.mode &&
    (a.mode !== 'perimeterCore' || a.perimeterDepthM === b.perimeterDepthM)
  )
}

/**
 * Whether a building's zoning setting now differs from what the last
 * Geospatial preprocessing run applied to it; null when no run has zoned it.
 */
export function buildingZoningChanged(
  zoning: ZoningState,
  buildingId: string,
): boolean | null {
  const published = zoning.published
  if (!published) return null
  return !sameBuildingZoning(
    resolveBuildingZoning(zoning, buildingId),
    resolveBuildingZoning(published, buildingId),
  )
}

/**
 * The buildings zoned by perimeter and core through their own override: they
 * use the project's perimeter depth whatever the project's mode is.
 */
export function depthOverrides(
  state: Pick<WorkbenchState, 'zoning' | 'buildings'>,
): string[] {
  return Object.entries(state.zoning.overrides)
    .filter(([id, mode]) => mode === 'perimeterCore' && state.buildings[id])
    .map(([id]) => id)
    .sort()
}

/**
 * Whether a project setting change gives any building other zones: the mode
 * or depth of the project's own zoning, or the depth that buildings
 * overridden to perimeter and core use.
 */
export function projectZoningChanges(
  state: Pick<WorkbenchState, 'zoning' | 'buildings'>,
  next: ZoningSetting,
): boolean {
  return (
    !sameZoning(next, state.zoning) ||
    (next.perimeterDepthM !== state.zoning.perimeterDepthM &&
      depthOverrides(state).length > 0)
  )
}

/** Whether any building's zones would differ from the last run's. */
export function zoningChangedSincePublished(zoning: ZoningState): boolean {
  const published = zoning.published
  if (!published) return false
  if (!sameZoning(published, zoning)) return true
  const ids = new Set([
    ...Object.keys(zoning.overrides),
    ...Object.keys(published.overrides),
  ])
  return [...ids].some((id) => buildingZoningChanged(zoning, id))
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

/** Whole building, whole floor, perimeter, core, or drawn (decision 0034). */
export type ZoneKind = 'building' | 'floor' | 'perimeter' | 'core' | 'drawn'

export const ZONE_KIND_LABELS: Record<ZoneKind, string> = {
  building: 'Whole building',
  floor: 'Whole floor',
  perimeter: 'Perimeter',
  core: 'Core',
  drawn: 'Drawn',
}

/** A zone's type in tables: its kind, and a drawn zone's use. */
export function zoneTypeLabel(zone: Pick<Zone, 'kind' | 'use'>): string {
  return zone.kind === 'drawn' && zone.use
    ? `Drawn: ${DRAWN_ZONE_USE_LABELS[zone.use].toLowerCase()}`
    : ZONE_KIND_LABELS[zone.kind]
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
  /** What a drawn zone is used for; null for generated zones. */
  use: DrawnZoneUse | null
  /** The zone's plan, a closed ring in longitude and latitude. */
  plan: LngLat[]
  /**
   * Which colour the zone takes: 0 to 2 for the categorical slots, chosen so
   * neighbouring zones differ; null for the core (the de-emphasis colour).
   */
  colorSlot: number | null
}

export type ZoningFallbackCode =
  | 'footprint_not_simple'
  | 'perimeter_inset_failed'
  | 'core_too_small'
  | DrawnFallbackCode

/** Why perimeter-and-core or drawn zoning fell back to one zone per floor. */
export type ZoningFallback = {
  code: ZoningFallbackCode
  message: string
}

export type BuildingZoning = {
  buildingId: string
  /** The setting asked for. */
  setting: BuildingZoningSetting
  /** What the building got: perimeterCore and drawn can fall back to floors. */
  appliedMode: BuildingZoningMode
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

type CacheEntry = { drawn: DrawnZoning | null; zoning: BuildingZoning | null }

const cache = new WeakMap<Building, Map<string, CacheEntry>>()

/**
 * A building's floors and zones under a zoning setting, or null when it has
 * no height or floor count yet (before Geospatial preprocessing). Drawn zones
 * (decision 0034) take the building's drawn outlines; without valid ones the
 * building falls back to one zone per floor, with the reason.
 */
export function zoneBuilding(
  building: Building,
  setting: BuildingZoningSetting,
  storeys: number | null = building.floors,
  drawn: DrawnZoning | null = null,
): BuildingZoning | null {
  const key = `${setting.mode}:${setting.perimeterDepthM}:${storeys}`
  let byBuilding = cache.get(building)
  if (!byBuilding) {
    byBuilding = new Map()
    cache.set(building, byBuilding)
  }
  const usesDrawn = setting.mode === 'drawn'
  const hit = byBuilding.get(key)
  if (hit && (!usesDrawn || hit.drawn === drawn)) return hit.zoning
  const zoning = computeZoning(building, setting, storeys, drawn)
  byBuilding.set(key, { drawn: usesDrawn ? drawn : null, zoning })
  return zoning
}

type FloorPlan = {
  zones: {
    kind: ZoneKind
    use: DrawnZoneUse | null
    name: string
    ring: Point[]
    facing: Facing | null
    colorSlot: number | null
  }[]
}

/** Drawn outlines on the building's plane, cleaned, or null for none. */
function drawnOnPlane(
  drawn: DrawnZoning | null,
  plane: ReturnType<typeof planeOf>,
): PlanePlan[] {
  return (drawn?.plans ?? []).map((plan) => ({
    fromFloor: plan.fromFloor,
    toFloor: plan.toFloor,
    zones: plan.zones.map((zone) => ({
      name: zone.name,
      use: zone.use,
      ring: cleanRing(zone.outline.map(plane.toPlane), 0.01) ?? [],
    })),
  }))
}

function computeZoning(
  building: Building,
  setting: BuildingZoningSetting,
  storeys: number | null,
  drawn: DrawnZoning | null,
): BuildingZoning | null {
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
  const plane = planeOf(building.footprint)

  // One plan per floor number; generated modes share one plan on every floor.
  let plans: ((floor: number) => FloorPlan) | null = null
  if (setting.mode === 'perimeterCore') {
    const result = perimeterCorePlan(
      building.footprint.map(plane.toPlane),
      setting.perimeterDepthM,
    )
    if ('fallback' in result) {
      fallback = result.fallback
      appliedMode = 'floors'
    } else {
      const perimeterSlots = ringSlots(result.zones.length - 1)
      const plan: FloorPlan = {
        zones: result.zones.map((zone, index) => ({
          kind: zone.kind,
          use: null,
          name: '',
          ring: zone.ring,
          facing: zone.facing,
          colorSlot:
            zone.kind === 'core' ? null : (perimeterSlots[index - 1] ?? 0),
        })),
      }
      plans = () => plan
    }
  } else if (setting.mode === 'drawn') {
    const planePlans = drawnOnPlane(drawn, plane)
    const problem = drawnPlanProblem(
      building.footprint.map(plane.toPlane),
      planePlans,
      count,
    )
    if (problem) {
      fallback = problem
      appliedMode = 'floors'
    } else {
      const byPlan = planePlans.map((plan) => {
        const slots = drawnColorSlots(plan.zones)
        return {
          plan,
          floorPlan: {
            zones: plan.zones.map((zone, index) => ({
              kind: 'drawn' as const,
              use: zone.use,
              name: zone.name,
              ring: zone.ring,
              facing: null,
              colorSlot: slots[index] ?? null,
            })),
          },
        }
      })
      plans = (floor) =>
        byPlan.find(
          ({ plan }) => plan.fromFloor <= floor && floor <= plan.toFloor,
        )?.floorPlan ?? { zones: [] }
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
      use: null,
      plan: outline,
      colorSlot: 0,
    })
    for (const floor of floors) floor.zoneIds.push(zoneId)
  } else if (appliedMode === 'floors' || !plans) {
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
        use: null,
        plan: outline,
        colorSlot: slots[floor.number - 1] ?? 0,
      })
      floor.zoneIds.push(zoneId)
    }
  } else {
    const toLngLat = plane.toLngLat
    for (const floor of floors) {
      const plan = plans(floor.number)
      // Plan areas are scaled so a floor's zones add up to the footprint area
      // exactly (the zones share the plane `ringAreaM2` uses).
      const planArea = plan.zones.reduce(
        (sum, zone) => sum + area(zone.ring),
        0,
      )
      const scale = planArea > 0 ? floorArea / planArea : 1
      plan.zones.forEach((zone, index) => {
        const zoneId = `${floor.id}:Z${index + 1}`
        const facing = zone.facing
        zones.push({
          id: zoneId,
          buildingId: id,
          name:
            zone.kind === 'drawn'
              ? `Floor ${floor.number} ${zone.name}`
              : zone.kind === 'core'
                ? `Floor ${floor.number} core`
                : `Floor ${floor.number} perimeter ${index}${facing ? ` (${facing})` : ''}`,
          kind: zone.kind,
          floor: floor.number,
          bottomM: floor.bottomM,
          topM: floor.topM,
          areaM2: round(area(zone.ring) * scale),
          facing,
          use: zone.use,
          plan: closed(zone.ring.map(toLngLat)),
          colorSlot: zone.colorSlot,
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

/**
 * A building's floors and zones as the last Geospatial preprocessing run zoned
 * it: by its own override then (decision 0034), else the project's mode.
 */
export function buildingZoning(
  state: Pick<WorkbenchState, 'zoning' | 'buildings'>,
  buildingId: string,
): BuildingZoning | null {
  const building = state.buildings[buildingId]
  const published = state.zoning.published
  if (!building || !published) return null
  return zoneBuilding(
    building,
    resolveBuildingZoning(published, buildingId),
    publishedStoreys(state, building),
    state.zoning.drawn[buildingId] ?? null,
  )
}

/**
 * How the last run zoned a building and whether by the project's default or
 * an override; null before a run has zoned it.
 */
export function publishedZoningOf(
  state: Pick<WorkbenchState, 'zoning'>,
  buildingId: string,
): (BuildingZoningSetting & { source: ZoningSource }) | null {
  const published = state.zoning.published
  return published ? resolveBuildingZoning(published, buildingId) : null
}

/**
 * The storeys a building is sliced into: those the last Geospatial
 * preprocessing run used, or its floor count when no run recorded them
 * (projects saved before zoning settings).
 */
export function publishedStoreys(
  state: Pick<WorkbenchState, 'zoning'>,
  building: Building,
): number | null {
  return state.zoning.published?.storeys[building.id] ?? building.floors
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
    { mode: 'single', perimeterDepthM: 0 },
    publishedStoreys(state, building),
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
  setting: BuildingZoningSetting,
  drawn: DrawnZoning | null = null,
): number | null {
  return (
    zoneBuilding(building, setting, building.floors, drawn)?.zones.length ??
    null
  )
}

/**
 * What a building would get under the project's current setting and its
 * override (decision 0034), as the next Geospatial preprocessing run would
 * zone it; null without a height or floor count.
 */
export function plannedZoning(
  state: Pick<WorkbenchState, 'zoning' | 'buildings'>,
  buildingId: string,
): BuildingZoning | null {
  const building = state.buildings[buildingId]
  if (!building) return null
  return zoneBuilding(
    building,
    resolveBuildingZoning(state.zoning, buildingId),
    building.floors,
    state.zoning.drawn[buildingId] ?? null,
  )
}

/** Fallbacks by code over the given buildings, for preprocessing's warnings. */
export function zoningFallbacks(
  buildings: Building[],
  settingFor: (building: Building) => {
    setting: BuildingZoningSetting
    drawn: DrawnZoning | null
  },
): Map<ZoningFallbackCode, string[]> {
  const byCode = new Map<ZoningFallbackCode, string[]>()
  for (const building of buildings) {
    const { setting, drawn } = settingFor(building)
    if (setting.mode !== 'perimeterCore' && setting.mode !== 'drawn') continue
    const fallback = zoneBuilding(
      building,
      setting,
      building.floors,
      drawn,
    )?.fallback
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
  drawn_zones_missing: 'they have no drawn zones',
  drawn_floors_mismatch: 'their drawn plans do not match their floors',
  drawn_zone_not_simple: 'a drawn zone is not a simple outline',
  drawn_zone_outside: 'a drawn zone leaves the footprint',
  drawn_zones_overlap: 'drawn zones overlap',
  drawn_zones_gap: 'the drawn zones leave part of a floor uncovered',
}

/** Every fallback code, for matching the coded warnings. */
export const ZONING_FALLBACK_CODES = Object.keys(
  FALLBACK_SUMMARIES,
) as ZoningFallbackCode[]

/** Whether a fallback code belongs to drawn zones. */
export function isDrawnFallback(code: ZoningFallbackCode): boolean {
  return code.startsWith('drawn_')
}

/**
 * RC-style coded warnings for buildings zoned one zone per floor instead of
 * perimeter and core, or instead of their drawn zones.
 */
export function fallbackWarnings(
  byCode: Map<ZoningFallbackCode, string[]>,
): { code: ZoningFallbackCode; buildingIds: string[]; message: string }[] {
  return [...byCode].map(([code, ids]) => ({
    code,
    buildingIds: ids,
    message: `${code}: ${ids.length} building${ids.length === 1 ? ' was' : 's were'} zoned one zone per floor instead of ${isDrawnFallback(code) ? 'drawn zones' : 'perimeter and core'} because ${FALLBACK_SUMMARIES[code]} (${ids.slice(0, 5).join(', ')}${ids.length > 5 ? `, and ${ids.length - 5} more` : ''}).`,
  }))
}

/**
 * Whole numbers proportional to the weights that add up to `total` rounded:
 * each takes its floor, and the largest remainders take the units left
 * (ties go to the earlier one).
 */
export function apportion(weights: number[], total: number): number[] {
  const target = Math.round(total)
  const sum = weights.reduce((acc, weight) => acc + weight, 0)
  if (weights.length === 0) return []
  if (!(sum > 0)) {
    return weights.map((_, index) => (index === 0 ? target : 0))
  }
  const exact = weights.map((weight) => (target * weight) / sum)
  const whole = exact.map((value) => Math.floor(value))
  let left = target - whole.reduce((acc, value) => acc + value, 0)
  const order = exact
    .map((value, index) => ({ index, remainder: value - Math.floor(value) }))
    .sort((a, b) => b.remainder - a.remainder || a.index - b.index)
  for (const { index } of order) {
    if (left <= 0) break
    whole[index] = (whole[index] ?? 0) + 1
    left -= 1
  }
  return whole
}

/**
 * The synthetic split of a building's demand over its floors and zones, by
 * floor-area share, in whole kWh: each set adds up to the building's total
 * rounded to whole kWh (largest remainders).
 */
export function demandShares(
  zoning: BuildingZoning,
  buildingKwh: number,
): { floors: Record<string, number>; zones: Record<string, number> } {
  const zoneKwh = apportion(
    zoning.zones.map((zone) => zone.areaM2),
    buildingKwh,
  )
  const floorKwh = apportion(
    zoning.floors.map(() => 1),
    buildingKwh,
  )
  return {
    zones: Object.fromEntries(
      zoning.zones.map((zone, index) => [zone.id, zoneKwh[index] ?? 0]),
    ),
    floors: Object.fromEntries(
      zoning.floors.map((floor, index) => [floor.id, floorKwh[index] ?? 0]),
    ),
  }
}
