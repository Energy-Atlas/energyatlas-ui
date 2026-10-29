import type { LngLat } from '../types.ts'
import {
  area,
  cleanRing,
  contains,
  isSimple,
  pointSegmentDistance,
  type Point,
} from './geometry.ts'

// Drawn zones (decision 0034): zone outlines per floor that no zoning mode
// generated, as a floor plan or an imported model would give. In this
// prototype they are hand-authored, stored with the project, and labelled
// synthetic; nothing edits them yet, and IDF, gbXML, or IFC import is
// deferred (RC has none either). They are checked against the footprint
// with plain polygon maths: every zone inside the outline, no two zones
// overlapping, and the zones covering the floor within a tolerance.

export const DRAWN_ZONE_USES = [
  'lobby',
  'retail',
  'office',
  'apartment',
  'corridor',
  'core',
  'service',
] as const

export type DrawnZoneUse = (typeof DRAWN_ZONE_USES)[number]

export const DRAWN_ZONE_USE_LABELS: Record<DrawnZoneUse, string> = {
  lobby: 'Lobby',
  retail: 'Retail',
  office: 'Office',
  apartment: 'Apartment',
  corridor: 'Corridor',
  core: 'Core',
  service: 'Service',
}

export type DrawnZone = {
  name: string
  use: DrawnZoneUse
  /** The zone's outline in longitude and latitude, without a closing point. */
  outline: LngLat[]
}

/** One plan shared by a run of storeys, `fromFloor` to `toFloor` inclusive. */
export type DrawnPlan = {
  fromFloor: number
  toFloor: number
  zones: DrawnZone[]
}

export type DrawnZoning = {
  /** Where the outlines came from, shown in Properties. */
  source: string
  plans: DrawnPlan[]
}

export type DrawnFallbackCode =
  | 'drawn_zones_missing'
  | 'drawn_floors_mismatch'
  | 'drawn_zone_not_simple'
  | 'drawn_zone_outside'
  | 'drawn_zones_overlap'
  | 'drawn_zones_gap'

/** How far a drawn corner may stray from where it should be, in metres. */
export const DRAWN_TOLERANCE_M = 0.25
/** Drawn zones must cover at least this share of the floor. */
export const DRAWN_MIN_COVERAGE = 0.98

const PREFIX = 'Drawn zones fell back to one zone per floor'

type Fallback = { code: DrawnFallbackCode; message: string }

/** A drawn zone on the local plane, cleaned. */
export type PlaneZone = {
  name: string
  use: DrawnZoneUse
  ring: Point[]
}

export type PlanePlan = {
  fromFloor: number
  toFloor: number
  zones: PlaneZone[]
}

function formatMetres(value: number): string {
  return `${value.toLocaleString('en-US', { maximumFractionDigits: 1 })} m`
}

function floorsLabel(from: number, to: number): string {
  return from === to ? `floor ${from}` : `floors ${from} to ${to}`
}

/** Distance from a point to a ring's boundary. */
function boundaryDistance(point: Point, ring: Point[]): number {
  let best = Infinity
  for (let index = 0; index < ring.length; index += 1) {
    const a = ring[index] ?? [0, 0]
    const b = ring[(index + 1) % ring.length] ?? a
    best = Math.min(best, pointSegmentDistance(point, a, b))
  }
  return best
}

/** Points along a ring's edges: every corner and `steps - 1` between each pair. */
function edgeSamples(ring: Point[], steps = 8): Point[] {
  const samples: Point[] = []
  for (let index = 0; index < ring.length; index += 1) {
    const a = ring[index] ?? [0, 0]
    const b = ring[(index + 1) % ring.length] ?? a
    for (let step = 0; step < steps; step += 1) {
      const t = step / steps
      samples.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t])
    }
  }
  return samples
}

/**
 * Points well inside a ring: each corner moved a short way along its inward
 * bisector, kept where it lands inside the ring.
 */
function interiorSamples(ring: Point[]): Point[] {
  const samples: Point[] = []
  const count = ring.length
  for (let index = 0; index < count; index += 1) {
    const previous = ring[(index + count - 1) % count] ?? [0, 0]
    const point = ring[index] ?? [0, 0]
    const next = ring[(index + 1) % count] ?? [0, 0]
    const toPrevious = [previous[0] - point[0], previous[1] - point[1]]
    const toNext = [next[0] - point[0], next[1] - point[1]]
    const lengthPrevious = Math.hypot(toPrevious[0] ?? 0, toPrevious[1] ?? 0)
    const lengthNext = Math.hypot(toNext[0] ?? 0, toNext[1] ?? 0)
    if (lengthPrevious === 0 || lengthNext === 0) continue
    const bisector: Point = [
      (toPrevious[0] ?? 0) / lengthPrevious + (toNext[0] ?? 0) / lengthNext,
      (toPrevious[1] ?? 0) / lengthPrevious + (toNext[1] ?? 0) / lengthNext,
    ]
    const length = Math.hypot(bisector[0], bisector[1])
    if (length < 1e-9) continue
    const reach = Math.min(1, lengthPrevious / 3, lengthNext / 3)
    const candidate: Point = [
      point[0] + (bisector[0] / length) * reach,
      point[1] + (bisector[1] / length) * reach,
    ]
    if (contains(ring, candidate)) samples.push(candidate)
  }
  return samples
}

/** Whether a point is inside a ring by more than the tolerance. */
function deepInside(point: Point, ring: Point[]): boolean {
  return (
    contains(ring, point) && boundaryDistance(point, ring) > DRAWN_TOLERANCE_M
  )
}

/** How far a ring strays outside the footprint, in metres; 0 when inside. */
function outsideBy(ring: Point[], footprint: Point[]): number {
  let worst = 0
  for (const point of edgeSamples(ring)) {
    if (contains(footprint, point)) continue
    worst = Math.max(worst, boundaryDistance(point, footprint))
  }
  return worst
}

function overlaps(a: Point[], b: Point[]): boolean {
  const probes = (ring: Point[]) => [
    ...edgeSamples(ring),
    ...interiorSamples(ring),
  ]
  return (
    probes(a).some((point) => deepInside(point, b)) ||
    probes(b).some((point) => deepInside(point, a))
  )
}

/**
 * Checks drawn plans against a footprint for `storeys` floors, on the local
 * plane. Null when they are valid; otherwise the first problem found, worst
 * first: the floors not covered by exactly one plan, then per plan a zone
 * that is not a simple outline, a zone that leaves the footprint, two zones
 * that overlap, and zones that leave part of the floor uncovered.
 */
export function drawnPlanProblem(
  footprint: Point[],
  plans: PlanePlan[],
  storeys: number,
): Fallback | null {
  if (plans.length === 0) {
    return {
      code: 'drawn_zones_missing',
      message: `${PREFIX}: this building has no drawn zones.`,
    }
  }
  const counts = Array.from({ length: storeys }, () => 0)
  const beyond = new Set<number>()
  for (const plan of plans) {
    for (let floor = plan.fromFloor; floor <= plan.toFloor; floor += 1) {
      if (floor >= 1 && floor <= storeys) {
        counts[floor - 1] = (counts[floor - 1] ?? 0) + 1
      } else {
        beyond.add(floor)
      }
    }
  }
  const missing = counts.flatMap((count, index) =>
    count === 0 ? [index + 1] : [],
  )
  const doubled = counts.flatMap((count, index) =>
    count > 1 ? [index + 1] : [],
  )
  if (missing.length > 0) {
    return {
      code: 'drawn_floors_mismatch',
      message: `${PREFIX}: no drawn plan covers ${missing.length === 1 ? 'floor' : 'floors'} ${missing.join(', ')} of ${storeys}.`,
    }
  }
  if (doubled.length > 0) {
    return {
      code: 'drawn_floors_mismatch',
      message: `${PREFIX}: ${doubled.length === 1 ? 'floor' : 'floors'} ${doubled.join(', ')} ${doubled.length === 1 ? 'has' : 'have'} more than one drawn plan.`,
    }
  }
  if (beyond.size > 0) {
    const floors = [...beyond].sort((a, b) => a - b)
    return {
      code: 'drawn_floors_mismatch',
      message: `${PREFIX}: the drawn plans describe ${floors.length === 1 ? 'floor' : 'floors'} ${floors.join(', ')}, but the building has ${storeys} ${storeys === 1 ? 'floor' : 'floors'}.`,
    }
  }
  const outline = cleanRing(footprint)
  if (!outline) {
    return {
      code: 'drawn_zone_not_simple',
      message: `${PREFIX}: the footprint has fewer than three distinct corners.`,
    }
  }
  const footprintArea = area(outline)
  for (const plan of plans) {
    const where = floorsLabel(plan.fromFloor, plan.toFloor)
    if (plan.zones.length === 0) {
      return {
        code: 'drawn_zones_missing',
        message: `${PREFIX}: the plan of ${where} has no zones.`,
      }
    }
    for (const zone of plan.zones) {
      if (zone.ring.length < 3 || !isSimple(zone.ring)) {
        return {
          code: 'drawn_zone_not_simple',
          message: `${PREFIX}: zone "${zone.name}" on ${where} is not a simple outline (it has fewer than three corners, or touches or crosses itself).`,
        }
      }
      const out = outsideBy(zone.ring, outline)
      if (out > DRAWN_TOLERANCE_M) {
        return {
          code: 'drawn_zone_outside',
          message: `${PREFIX}: zone "${zone.name}" on ${where} leaves the footprint by up to ${formatMetres(out)} (${formatMetres(DRAWN_TOLERANCE_M)} allowed).`,
        }
      }
    }
    for (let i = 0; i < plan.zones.length; i += 1) {
      for (let j = i + 1; j < plan.zones.length; j += 1) {
        const a = plan.zones[i]
        const b = plan.zones[j]
        if (a && b && overlaps(a.ring, b.ring)) {
          return {
            code: 'drawn_zones_overlap',
            message: `${PREFIX}: zones "${a.name}" and "${b.name}" on ${where} overlap.`,
          }
        }
      }
    }
    const covered = plan.zones.reduce((sum, zone) => sum + area(zone.ring), 0)
    const share = footprintArea > 0 ? covered / footprintArea : 0
    if (share < DRAWN_MIN_COVERAGE) {
      return {
        code: 'drawn_zones_gap',
        message: `${PREFIX}: the zones of ${where} cover ${Math.floor(share * 1000) / 10}% of the floor, less than ${DRAWN_MIN_COVERAGE * 100}%.`,
      }
    }
  }
  return null
}

/** Whether two rings share a stretch of boundary (sampled), so they are neighbours. */
function neighbours(a: Point[], b: Point[]): boolean {
  let touching = 0
  for (const point of edgeSamples(a)) {
    if (boundaryDistance(point, b) <= DRAWN_TOLERANCE_M) touching += 1
    if (touching >= 2) return true
  }
  return false
}

/**
 * Categorical slots for one plan's zones so neighbours differ where three
 * colours allow, in drawing order; the core takes the de-emphasis colour
 * (null), as a generated core does.
 */
export function drawnColorSlots(zones: PlaneZone[]): (number | null)[] {
  const slots: (number | null)[] = []
  zones.forEach((zone, index) => {
    if (zone.use === 'core') {
      slots.push(null)
      return
    }
    const used = new Set<number>()
    zones.forEach((other, otherIndex) => {
      const slot = slots[otherIndex]
      if (otherIndex >= index || slot === null || slot === undefined) return
      if (neighbours(zone.ring, other.ring)) used.add(slot)
    })
    const free = [0, 1, 2].find((slot) => !used.has(slot))
    slots.push(free ?? index % 3)
  })
  return slots
}
