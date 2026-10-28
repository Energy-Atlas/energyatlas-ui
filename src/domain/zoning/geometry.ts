// Demo-grade planar geometry for perimeter-and-core zoning (decision 0032,
// stage 6). Rings are in metres on a local plane, counter-clockwise, without a
// repeated closing point. Nothing here is a general polygon library: it offsets
// a simple polygon's edges inward with mitred corners and refuses every case
// where that is not a valid core, so the caller can fall back to one zone per
// floor. RC uses NetTopologySuite's buffer and a Voronoi split
// (EnergyAtlasLib/Factory/BuildingZoner.cs); no geometry package is added here.

export type Point = [number, number]

/** Twice the signed area: positive for counter-clockwise rings. */
function doubleSignedArea(ring: Point[]): number {
  let sum = 0
  for (let index = 0; index < ring.length; index += 1) {
    const [x1, y1] = ring[index] ?? [0, 0]
    const [x2, y2] = ring[(index + 1) % ring.length] ?? [0, 0]
    sum += x1 * y2 - x2 * y1
  }
  return sum
}

export function signedArea(ring: Point[]): number {
  return doubleSignedArea(ring) / 2
}

export function area(ring: Point[]): number {
  return Math.abs(signedArea(ring))
}

function distance(a: Point, b: Point): number {
  return Math.hypot(b[0] - a[0], b[1] - a[1])
}

/** Distance from a point to the segment a–b. */
export function pointSegmentDistance(point: Point, a: Point, b: Point): number {
  const dx = b[0] - a[0]
  const dy = b[1] - a[1]
  const length2 = dx * dx + dy * dy
  if (length2 === 0) return distance(point, a)
  const t = Math.max(
    0,
    Math.min(1, ((point[0] - a[0]) * dx + (point[1] - a[1]) * dy) / length2),
  )
  return distance(point, [a[0] + t * dx, a[1] + t * dy])
}

/** Distance of b from the straight line through a and c. */
function lineDistance(b: Point, a: Point, c: Point): number {
  const length = distance(a, c)
  if (length === 0) return distance(a, b)
  return (
    Math.abs((c[0] - a[0]) * (b[1] - a[1]) - (c[1] - a[1]) * (b[0] - a[0])) /
    length
  )
}

/**
 * A ring without its closing point, repeated points, or points within
 * `tolerance` of the line through their neighbours, turned counter-clockwise.
 * Null when fewer than three points remain.
 */
export function cleanRing(points: Point[], tolerance = 0.1): Point[] | null {
  let ring = points.slice()
  const first = ring[0]
  const last = ring.at(-1)
  if (first && last && distance(first, last) <= tolerance) ring.pop()
  let changed = true
  while (changed && ring.length >= 3) {
    changed = false
    for (let index = 0; index < ring.length; index += 1) {
      const previous = ring[(index + ring.length - 1) % ring.length]
      const point = ring[index]
      const next = ring[(index + 1) % ring.length]
      if (!previous || !point || !next) continue
      if (
        distance(previous, point) <= tolerance ||
        lineDistance(point, previous, next) <= tolerance
      ) {
        ring.splice(index, 1)
        changed = true
        break
      }
    }
  }
  if (ring.length < 3) return null
  if (doubleSignedArea(ring) < 0) ring = ring.reverse()
  return ring
}

function orientation(a: Point, b: Point, c: Point): number {
  return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])
}

function onSegment(a: Point, b: Point, point: Point, epsilon: number): boolean {
  return (
    Math.min(a[0], b[0]) - epsilon <= point[0] &&
    point[0] <= Math.max(a[0], b[0]) + epsilon &&
    Math.min(a[1], b[1]) - epsilon <= point[1] &&
    point[1] <= Math.max(a[1], b[1]) + epsilon
  )
}

/** Whether segments a–b and c–d meet, touching included. */
export function segmentsMeet(a: Point, b: Point, c: Point, d: Point): boolean {
  const epsilon = 1e-9
  const o1 = orientation(a, b, c)
  const o2 = orientation(a, b, d)
  const o3 = orientation(c, d, a)
  const o4 = orientation(c, d, b)
  const sign = (value: number) =>
    Math.abs(value) <= epsilon ? 0 : Math.sign(value)
  const [s1, s2, s3, s4] = [sign(o1), sign(o2), sign(o3), sign(o4)]
  if (s1 * s2 < 0 && s3 * s4 < 0) return true
  if (s1 === 0 && onSegment(a, b, c, epsilon)) return true
  if (s2 === 0 && onSegment(a, b, d, epsilon)) return true
  if (s3 === 0 && onSegment(c, d, a, epsilon)) return true
  if (s4 === 0 && onSegment(c, d, b, epsilon)) return true
  return false
}

/**
 * Whether a ring is simple: no repeated point and no two edges that meet
 * except neighbours at their shared point. OpenStreetMap footprints that
 * touch themselves fail this.
 */
export function isSimple(ring: Point[], tolerance = 1e-6): boolean {
  const count = ring.length
  if (count < 3) return false
  for (let i = 0; i < count; i += 1) {
    for (let j = i + 1; j < count; j += 1) {
      const a = ring[i]
      const b = ring[j]
      if (a && b && distance(a, b) <= tolerance) return false
    }
  }
  for (let i = 0; i < count; i += 1) {
    const a = ring[i] ?? [0, 0]
    const b = ring[(i + 1) % count] ?? [0, 0]
    for (let j = i + 1; j < count; j += 1) {
      // Neighbouring edges share a point by construction.
      if (j === i + 1 || (i === 0 && j === count - 1)) continue
      const c = ring[j] ?? [0, 0]
      const d = ring[(j + 1) % count] ?? [0, 0]
      if (segmentsMeet(a, b, c, d)) return false
    }
  }
  return true
}

/** Even-odd point in polygon. */
export function contains(ring: Point[], point: Point): boolean {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const [xi, yi] = ring[i] ?? [0, 0]
    const [xj, yj] = ring[j] ?? [0, 0]
    if (
      yi > point[1] !== yj > point[1] &&
      point[0] < ((xj - xi) * (point[1] - yi)) / (yj - yi) + xi
    ) {
      inside = !inside
    }
  }
  return inside
}

export type InsetFailure =
  'not_simple' | 'edge_collapsed' | 'core_crosses_perimeter' | 'core_outside'

export type Inset =
  | {
      ok: true
      /** The core ring; `core[i]` is the inset of `ring[i]`. */
      core: Point[]
    }
  | { ok: false; failure: InsetFailure }

/**
 * Offsets every edge of a simple counter-clockwise ring `depth` metres
 * inward and joins neighbouring offsets at their intersection (a mitre), so
 * the core keeps one point per footprint point. Refused, rather than
 * repaired, when an offset edge collapses or turns round, when the core is
 * not simple, leaves the footprint, or comes closer than `depth` to any
 * footprint edge (a narrow part of a concave footprint).
 */
export function insetRing(ring: Point[], depth: number): Inset {
  const count = ring.length
  if (count < 3 || !isSimple(ring)) return { ok: false, failure: 'not_simple' }
  const lines = ring.map((start, index) => {
    const end = ring[(index + 1) % count] ?? start
    const length = distance(start, end)
    const direction: Point = [
      (end[0] - start[0]) / length,
      (end[1] - start[1]) / length,
    ]
    // The inward normal of a counter-clockwise ring is on the left.
    const normal: Point = [-direction[1], direction[0]]
    const origin: Point = [
      start[0] + normal[0] * depth,
      start[1] + normal[1] * depth,
    ]
    return { origin, direction }
  })
  const core: Point[] = []
  for (let index = 0; index < count; index += 1) {
    const previous = lines[(index + count - 1) % count]
    const current = lines[index]
    if (!previous || !current) return { ok: false, failure: 'edge_collapsed' }
    const cross =
      previous.direction[0] * current.direction[1] -
      previous.direction[1] * current.direction[0]
    // Cleaned rings have no straight points, so parallel neighbours turn
    // back on themselves.
    if (Math.abs(cross) < 1e-9) return { ok: false, failure: 'edge_collapsed' }
    const dx = current.origin[0] - previous.origin[0]
    const dy = current.origin[1] - previous.origin[1]
    const t = (dx * current.direction[1] - dy * current.direction[0]) / cross
    core.push([
      previous.origin[0] + previous.direction[0] * t,
      previous.origin[1] + previous.direction[1] * t,
    ])
  }
  for (let index = 0; index < count; index += 1) {
    const start = core[index] ?? [0, 0]
    const end = core[(index + 1) % count] ?? [0, 0]
    const direction = lines[index]?.direction ?? [0, 0]
    const along =
      (end[0] - start[0]) * direction[0] + (end[1] - start[1]) * direction[1]
    if (!(along > 1e-6)) return { ok: false, failure: 'edge_collapsed' }
  }
  if (!isSimple(core) || doubleSignedArea(core) <= 0) {
    return { ok: false, failure: 'edge_collapsed' }
  }
  const minimum = depth * (1 - 1e-6) - 1e-9
  for (const point of core) {
    if (!contains(ring, point)) return { ok: false, failure: 'core_outside' }
    for (let index = 0; index < count; index += 1) {
      const a = ring[index] ?? [0, 0]
      const b = ring[(index + 1) % count] ?? [0, 0]
      if (pointSegmentDistance(point, a, b) < minimum) {
        return { ok: false, failure: 'core_crosses_perimeter' }
      }
    }
  }
  for (const point of ring) {
    for (let index = 0; index < count; index += 1) {
      const a = core[index] ?? [0, 0]
      const b = core[(index + 1) % count] ?? [0, 0]
      if (pointSegmentDistance(point, a, b) < minimum) {
        return { ok: false, failure: 'core_crosses_perimeter' }
      }
    }
  }
  return { ok: true, core }
}

/**
 * The perimeter band between a ring and its core, split into one polygon per
 * group of consecutive edges: edge `i` runs from `ring[i]` to `ring[i + 1]`,
 * and its share of the band is bounded by the mitre lines at both ends.
 */
export function perimeterCells(
  ring: Point[],
  core: Point[],
  groups: number[][],
): Point[][] {
  const count = ring.length
  return groups.map((edges) => {
    const first = edges[0] ?? 0
    const outer: Point[] = []
    const inner: Point[] = []
    for (let step = 0; step <= edges.length; step += 1) {
      const index = (first + step) % count
      outer.push(ring[index] ?? [0, 0])
      inner.push(core[index] ?? [0, 0])
    }
    return [...outer, ...inner.reverse()]
  })
}

/**
 * Groups edges so that an edge shorter than `minimum` joins the zone of the
 * edge before it, starting from the first long edge. With fewer than three
 * long edges every edge keeps its own zone, as in RC.
 */
export function groupEdges(ring: Point[], minimum: number): number[][] {
  const count = ring.length
  const lengths = ring.map((point, index) =>
    distance(point, ring[(index + 1) % count] ?? point),
  )
  const long = lengths.filter((length) => length >= minimum).length
  if (long < 3) return lengths.map((_, index) => [index])
  const start = lengths.findIndex((length) => length >= minimum)
  const groups: number[][] = []
  for (let step = 0; step < count; step += 1) {
    const index = (start + step) % count
    if ((lengths[index] ?? 0) >= minimum || groups.length === 0) {
      groups.push([index])
    } else {
      groups.at(-1)?.push(index)
    }
  }
  return groups
}

/** Compass point an edge faces outward, for zone names. */
export type Facing =
  | 'north'
  | 'northeast'
  | 'east'
  | 'southeast'
  | 'south'
  | 'southwest'
  | 'west'
  | 'northwest'

const FACINGS: Facing[] = [
  'east',
  'northeast',
  'north',
  'northwest',
  'west',
  'southwest',
  'south',
  'southeast',
]

/** Where the outward normal of the edge a–b of a counter-clockwise ring points (x east, y north). */
export function facingOf(a: Point, b: Point): Facing {
  // Outward is on the right of a counter-clockwise ring.
  const angle = Math.atan2(-(b[0] - a[0]), b[1] - a[1])
  const octant = Math.round(angle / (Math.PI / 4))
  return FACINGS[(octant + 8) % 8] ?? 'north'
}
