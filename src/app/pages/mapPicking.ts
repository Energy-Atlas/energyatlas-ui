import type { LngLat } from '../../domain/types.ts'
import { toMercator } from './silhouette.ts'

// Which extruded feature a click in 3D is on (decision 0036, M2 and M3).
// MapLibre 6's queryRenderedFeatures does not return fill-extrusion hits
// nearest first: across the zone layers and the stack, and within one layer,
// they came back in source order, so a click on a building's roof picked its
// ground floor, a click on a floor picked the cell the ray left it by, and a
// building behind another could win the click. The map therefore measures
// each hit itself: the distance along the pointer's ray from the camera to
// the first face of the hit's prism, in Mercator units.

export type Vec3 = [number, number, number]

/** A ray from the camera through the pointer; `t = 1` is where it meets the ground. */
export type Ray = { origin: Vec3; direction: Vec3 }

/** An extruded polygon in Mercator units: an outer ring, its base, and its top. */
export type Prism = {
  ring: [number, number][]
  base: number
  top: number
}

/** Whether a point lies inside a ring (even-odd rule; the ring may be closed or open). */
export function insideRing(
  ring: readonly [number, number][],
  x: number,
  y: number,
): boolean {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const [xi, yi] = ring[i] ?? [0, 0]
    const [xj, yj] = ring[j] ?? [0, 0]
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) {
      inside = !inside
    }
  }
  return inside
}

/**
 * The distance along the ray (in units of its direction) to the nearest face
 * of the prism it enters, or null when it misses: the top and base where the
 * ray crosses their planes inside the ring, and each wall where the ray
 * crosses it between base and top.
 */
export function rayPrismDistance(ray: Ray, prism: Prism): number | null {
  const [ox, oy, oz] = ray.origin
  const [dx, dy, dz] = ray.direction
  let best: number | null = null
  const consider = (t: number) => {
    if (t > 0 && (best === null || t < best)) best = t
  }
  if (dz !== 0) {
    for (const z of [prism.top, prism.base]) {
      const t = (z - oz) / dz
      if (t > 0 && insideRing(prism.ring, ox + t * dx, oy + t * dy)) {
        consider(t)
      }
    }
  }
  const ring = prism.ring
  for (let index = 0; index < ring.length; index += 1) {
    const [px, py] = ring[index] ?? [0, 0]
    const [qx, qy] = ring[(index + 1) % ring.length] ?? [px, py]
    const ex = qx - px
    const ey = qy - py
    // Solve origin + t·direction = p + s·(q − p) in the plane.
    const denominator = dx * ey - dy * ex
    if (denominator === 0) continue
    const wx = px - ox
    const wy = py - oy
    const t = (wx * ey - wy * ex) / denominator
    const s = (wx * dy - wy * dx) / denominator
    if (s < 0 || s > 1 || !(t > 0)) continue
    const z = oz + t * dz
    if (z >= prism.base && z <= prism.top) consider(t)
  }
  return best
}

/** The camera as MapLibre's public getters describe it. */
export type CameraView = {
  center: LngLat
  /** The elevation of the centre point (terrain), in metres. */
  centerElevationM: number
  zoom: number
  pitchDeg: number
  bearingDeg: number
  /** Vertical field of view. */
  fovDeg: number
  /** The canvas height in CSS pixels. */
  heightPx: number
}

/** MapLibre's world size at zoom 0, in pixels. */
const TILE_SIZE = 512

/**
 * Where the camera is, in Mercator units: behind the centre along the
 * bearing and above it by the pitch, at MapLibre's distance of half the
 * canvas height over the tangent of half the field of view.
 */
export function cameraPosition(view: CameraView): Vec3 {
  const [cx, cy, cz] = toMercator(view.center, view.centerElevationM)
  const fov = (view.fovDeg * Math.PI) / 180
  const pitch = (view.pitchDeg * Math.PI) / 180
  const bearing = (view.bearingDeg * Math.PI) / 180
  const distancePx = (0.5 * view.heightPx) / Math.tan(fov / 2)
  const distance = distancePx / (TILE_SIZE * 2 ** view.zoom)
  const horizontal = distance * Math.sin(pitch)
  return [
    cx - horizontal * Math.sin(bearing),
    cy + horizontal * Math.cos(bearing),
    cz + distance * Math.cos(pitch),
  ]
}

/** The ray from the camera through the ground point under the pointer. */
export function pointerRay(
  view: CameraView,
  ground: LngLat,
  groundElevationM = 0,
): Ray {
  const origin = cameraPosition(view)
  const target = toMercator(ground, groundElevationM)
  return {
    origin,
    direction: [
      target[0] - origin[0],
      target[1] - origin[1],
      target[2] - origin[2],
    ],
  }
}

/** A footprint ring and heights in metres as a Mercator prism, lifted by `liftM` (terrain). */
export function prismOf(
  ring: readonly LngLat[],
  baseM: number,
  topM: number,
  liftM = 0,
): Prism {
  const first = ring[0] ?? [0, 0]
  // Altitude units depend on latitude; one sample per building is exact enough.
  const unit = toMercator(first, 1)[2]
  return {
    ring: ring.map((point) => {
      const [x, y] = toMercator(point, 0)
      return [x, y]
    }),
    base: (baseM + liftM) * unit,
    top: (topM + liftM) * unit,
  }
}

/**
 * Items sorted nearest first by their distance along the ray; items with no
 * prism (flat features on the ground) count as on the ground (`t = 1`), and
 * prisms the ray misses go last, keeping MapLibre's order among equals.
 */
export function sortByDistance<T>(
  items: readonly T[],
  ray: Ray,
  prismOfItem: (item: T) => Prism | null,
): T[] {
  return items
    .map((item, index) => {
      const prism = prismOfItem(item)
      const distance =
        prism === null ? 1 : (rayPrismDistance(ray, prism) ?? Infinity)
      return { item, index, distance }
    })
    .sort((a, b) => a.distance - b.distance || a.index - b.index)
    .map(({ item }) => item)
}
