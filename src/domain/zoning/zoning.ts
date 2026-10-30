import type { Building, LngLat, WorkbenchState } from '../types.ts'

// Floors and zones (decision 0032, stage 6; decision 0036). Zoning is done by
// the backend: the browser computes no zones. A building's zones arrive as
// geometry, here precomputed in the fixture for a few example buildings
// (`state.zoning.geometry`, standing in for the backend's output); every
// other building is one zone, as RC zones a building when a run asks for no
// zoning (ThermalZoningPolicy.Single). Floors are uniform, the building's
// height over its storeys (ThermalZoningPolicy.cs:39-51). Floors and zones
// are derived once Geospatial preprocessing has published; they are never
// edited in the browser.

/** Whole building, whole floor, perimeter, core, or drawn (a floor plan's room). */
export type ZoneKind = 'building' | 'floor' | 'perimeter' | 'core' | 'drawn'

export const ZONE_KINDS = [
  'floor',
  'perimeter',
  'core',
  'drawn',
] as const satisfies readonly Exclude<ZoneKind, 'building'>[]

export const ZONE_KIND_LABELS: Record<ZoneKind, string> = {
  building: 'Whole building',
  floor: 'Whole floor',
  perimeter: 'Perimeter',
  core: 'Core',
  drawn: 'Drawn',
}

/** What a drawn zone (a room of a floor plan) is used for. */
export const ZONE_USES = [
  'lobby',
  'retail',
  'office',
  'apartment',
  'corridor',
  'core',
  'service',
] as const

export type ZoneUse = (typeof ZONE_USES)[number]

export const ZONE_USE_LABELS: Record<ZoneUse, string> = {
  lobby: 'Lobby',
  retail: 'Retail',
  office: 'Office',
  apartment: 'Apartment',
  corridor: 'Corridor',
  core: 'Core',
  service: 'Service',
}

/** Compass point a perimeter zone faces outward, for its name. */
export const FACINGS = [
  'north',
  'northeast',
  'east',
  'southeast',
  'south',
  'southwest',
  'west',
  'northwest',
] as const

export type Facing = (typeof FACINGS)[number]

/** A zone's type in tables: its kind, and a drawn zone's use. */
export function zoneTypeLabel(zone: Pick<Zone, 'kind' | 'use'>): string {
  return zone.kind === 'drawn' && zone.use
    ? `Drawn: ${ZONE_USE_LABELS[zone.use].toLowerCase()}`
    : ZONE_KIND_LABELS[zone.kind]
}

/** One zone of a floor plan as the backend delivers it. */
export type ZoneGeometryZone = {
  /** Its name on the floor ("lobby", "perimeter 1"); empty for a whole floor. */
  name: string
  kind: Exclude<ZoneKind, 'building'>
  use: ZoneUse | null
  facing: Facing | null
  /** The outline in longitude and latitude, without a closing point. */
  outline: LngLat[]
}

/** One plan shared by a run of storeys, `fromFloor` to `toFloor` inclusive. */
export type ZoneGeometryPlan = {
  fromFloor: number
  toFloor: number
  zones: ZoneGeometryZone[]
}

/** The highest floor a saved zone plan may name. */
export const MAX_ZONE_FLOOR = 500

/** A building's zone geometry: one plan per run of storeys, covering every floor. */
export type BuildingZoneGeometry = {
  /** Where the geometry came from, shown in Properties. */
  source: string
  plans: ZoneGeometryPlan[]
}

/**
 * The run of Geospatial preprocessing that floors and zones follow, with the
 * storeys each building had then: floors are sliced from those, not from a
 * floor count edited since, until the stage runs again.
 */
export type PublishedZoning = {
  runId: string
  storeys: Record<string, number>
}

export type ZoningState = {
  /**
   * Zone geometry by building id, as the backend would deliver it (decision
   * 0036): precomputed in the fixture for a few buildings, synthetic.
   */
  geometry: Record<string, BuildingZoneGeometry>
  /** The last successful Geospatial preprocessing run; null before one. */
  published: PublishedZoning | null
}

export function initialZoning(): ZoningState {
  return { geometry: {}, published: null }
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
  /** Positional, as RC's (DeterministicIds.cs:22): `<building>:Z1`, or `<building>:F<n>:Z<k>` in the plan's order. */
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
  facing: Facing | null
  use: ZoneUse | null
  /** The zone's plan, a closed ring in longitude and latitude. */
  plan: LngLat[]
  /**
   * Which colour the zone takes: 0 to 2 for the categorical slots, chosen so
   * zones sharing a wall differ where three colours allow; null for a core
   * (the de-emphasis colour).
   */
  colorSlot: number | null
}

export type BuildingZoning = {
  buildingId: string
  floorHeightM: number
  floors: Floor[]
  zones: Zone[]
  /** `geometry` when the backend's zone geometry is shown; `single` for one zone. */
  source: 'geometry' | 'single'
  /**
   * Why zone geometry stored for the building is not shown (it does not
   * cover the building's floors); null otherwise.
   */
  unused: string | null
}

const METERS_PER_DEGREE = 111_320

/** A ring's area in square metres on a local plane, as `ringAreaM2` measures footprints. */
function ringAreaM2(ring: LngLat[]): number {
  const [originLng, originLat] = ring[0] ?? [0, 0]
  const metersPerLng = METERS_PER_DEGREE * Math.cos((originLat * Math.PI) / 180)
  let sum = 0
  for (let index = 1; index < ring.length; index += 1) {
    const [x1, y1] = ring[index - 1] ?? [originLng, originLat]
    const [x2, y2] = ring[index] ?? [originLng, originLat]
    sum +=
      (x1 - originLng) * (y2 - originLat) - (x2 - originLng) * (y1 - originLat)
  }
  return (Math.abs(sum) / 2) * metersPerLng * METERS_PER_DEGREE
}

function round(value: number, digits = 2): number {
  const factor = 10 ** digits
  return Math.round(value * factor) / factor
}

function closed(ring: LngLat[]): LngLat[] {
  const first = ring[0]
  const last = ring.at(-1)
  if (!first || !last) return ring
  return first[0] === last[0] && first[1] === last[1] ? ring : [...ring, first]
}

function open(ring: LngLat[]): LngLat[] {
  const first = ring[0]
  const last = ring.at(-1)
  return ring.length > 1 &&
    first &&
    last &&
    first[0] === last[0] &&
    first[1] === last[1]
    ? ring.slice(0, -1)
    : ring
}

/** Why a building's zone geometry does not fit its storeys, or null when it does. */
export function geometryMismatch(
  geometry: BuildingZoneGeometry,
  storeys: number,
): string | null {
  for (let floor = 1; floor <= storeys; floor += 1) {
    const covering = geometry.plans.filter(
      (plan) => plan.fromFloor <= floor && floor <= plan.toFloor,
    )
    if (covering.length !== 1 || (covering[0]?.zones.length ?? 0) === 0) {
      return `its zone geometry has no single plan for floor ${floor}`
    }
  }
  const beyond = geometry.plans.some((plan) => plan.toFloor > storeys)
  return beyond ? `its zone geometry names floors above its ${storeys}` : null
}

const vertexKey = ([lng, lat]: LngLat) => `${lng},${lat}`

/**
 * Colour slots for a plan's zones: a core takes the de-emphasis colour, and
 * every other zone the first of three slots no earlier zone sharing a wall
 * with it took. Zones share a wall when their outlines share two
 * consecutive corners, as the backend's tiling makes them.
 */
export function zoneColorSlots(zones: ZoneGeometryZone[]): (number | null)[] {
  const edgesOf = (outline: LngLat[]) =>
    new Set(
      outline.map((point, index) => {
        const next = outline[(index + 1) % outline.length] ?? point
        const [a, b] = [vertexKey(point), vertexKey(next)].sort()
        return `${a}|${b}`
      }),
    )
  const edges = zones.map((zone) => edgesOf(zone.outline))
  const slots: (number | null)[] = []
  zones.forEach((zone, index) => {
    if (zone.kind === 'core') {
      slots.push(null)
      return
    }
    const own = edges[index] ?? new Set<string>()
    const taken = new Set<number>()
    for (let other = 0; other < index; other += 1) {
      const slot = slots[other]
      if (slot === null || slot === undefined) continue
      const theirs = edges[other] ?? new Set<string>()
      if ([...own].some((edge) => theirs.has(edge))) taken.add(slot)
    }
    slots.push([0, 1, 2].find((slot) => !taken.has(slot)) ?? index % 3)
  })
  return slots
}

function zoneName(zone: ZoneGeometryZone, floor: number): string {
  if (zone.kind === 'floor') return `Floor ${floor}`
  const facing = zone.facing ? ` (${zone.facing})` : ''
  return `Floor ${floor} ${zone.name}${facing}`
}

type CacheEntry = {
  geometry: BuildingZoneGeometry | null
  zoning: BuildingZoning | null
}

const cache = new WeakMap<Building, Map<number | null, CacheEntry>>()

/**
 * A building's floors and zones: the backend's zone geometry when it has
 * some that covers its floors, else one zone; null when it has no height or
 * floor count yet (before Geospatial preprocessing).
 */
export function zoneBuilding(
  building: Building,
  storeys: number | null = building.floors,
  geometry: BuildingZoneGeometry | null = null,
): BuildingZoning | null {
  let byBuilding = cache.get(building)
  if (!byBuilding) {
    byBuilding = new Map()
    cache.set(building, byBuilding)
  }
  const hit = byBuilding.get(storeys)
  if (hit && hit.geometry === geometry) return hit.zoning
  const zoning = computeZoning(building, storeys, geometry)
  byBuilding.set(storeys, { geometry, zoning })
  return zoning
}

function computeZoning(
  building: Building,
  storeys: number | null,
  geometry: BuildingZoneGeometry | null,
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
  const mismatch = geometry ? geometryMismatch(geometry, count) : null
  const zones: Zone[] = []
  if (!geometry || mismatch) {
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
      plan: closed(building.footprint),
      colorSlot: 0,
    })
    for (const floor of floors) floor.zoneIds.push(zoneId)
  } else {
    const slotsByPlan = new Map(
      geometry.plans.map((plan) => [plan, zoneColorSlots(plan.zones)]),
    )
    for (const floor of floors) {
      const plan = geometry.plans.find(
        (each) =>
          each.fromFloor <= floor.number && floor.number <= each.toFloor,
      )
      if (!plan) continue
      const slots = slotsByPlan.get(plan) ?? []
      // Areas are scaled so a floor's zones add up to the footprint area
      // exactly (the zones tile the footprint).
      const areas = plan.zones.map((zone) => ringAreaM2(closed(zone.outline)))
      const planArea = areas.reduce((sum, value) => sum + value, 0)
      const scale = planArea > 0 ? floorArea / planArea : 1
      plan.zones.forEach((zone, index) => {
        const zoneId = `${floor.id}:Z${index + 1}`
        zones.push({
          id: zoneId,
          buildingId: id,
          name: zoneName(zone, floor.number),
          kind: zone.kind,
          floor: floor.number,
          bottomM: floor.bottomM,
          topM: floor.topM,
          areaM2: round((areas[index] ?? 0) * scale),
          facing: zone.facing,
          use: zone.use,
          plan: closed(open(zone.outline)),
          // Whole floors alternate up the building.
          colorSlot:
            zone.kind === 'floor'
              ? (floor.number - 1) % 3
              : slots[index] === undefined
                ? 0
                : slots[index],
        })
        floor.zoneIds.push(zoneId)
      })
    }
  }
  return {
    buildingId: id,
    floorHeightM: round(floorHeight),
    floors,
    zones,
    source: geometry && !mismatch ? 'geometry' : 'single',
    unused: mismatch,
  }
}

/**
 * A building's floors and zones as the last Geospatial preprocessing run
 * left them, with the backend's zone geometry; null before a run has zoned it.
 */
export function buildingZoning(
  state: Pick<WorkbenchState, 'zoning' | 'buildings'>,
  buildingId: string,
): BuildingZoning | null {
  const building = state.buildings[buildingId]
  if (!building || !state.zoning.published) return null
  return zoneBuilding(
    building,
    publishedStoreys(state, building),
    state.zoning.geometry[buildingId] ?? null,
  )
}

/** A building's zoning in words, for summaries. */
export function describeBuildingZoning(zoning: BuildingZoning): string {
  if (zoning.source === 'single') return 'one zone'
  const kinds = new Set(zoning.zones.map((zone) => zone.kind))
  if (kinds.size === 1 && kinds.has('floor')) return 'each floor a zone'
  if (kinds.has('core') && kinds.has('perimeter')) {
    return 'perimeter and core zones on each floor'
  }
  return 'zones of its floor plans'
}

/**
 * The storeys a building is sliced into: those the last Geospatial
 * preprocessing run used, or its floor count when no run recorded them.
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
  return zoneBuilding(building, publishedStoreys(state, building))?.floors ?? []
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

/** How many zones a building gets, as preprocessing publishes. */
export function zoneCountFor(
  building: Building,
  geometry: BuildingZoneGeometry | null = null,
): number | null {
  return zoneBuilding(building, building.floors, geometry)?.zones.length ?? null
}
