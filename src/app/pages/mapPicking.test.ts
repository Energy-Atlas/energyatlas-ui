import { describe, expect, it } from 'vitest'
import type { LngLat } from '../../domain/types.ts'
import {
  cameraPosition,
  insideRing,
  pointerRay,
  prismOf,
  rayPrismDistance,
  sortByDistance,
  type CameraView,
  type Ray,
} from './mapPicking.ts'
import { toMercator } from './silhouette.ts'

// Picking the nearest extruded hit (decision 0036, M2 and M3).

const square = (x: number, y: number, size = 1): [number, number][] => [
  [x, y],
  [x + size, y],
  [x + size, y + size],
  [x, y + size],
]

describe('rayPrismDistance', () => {
  it('meets the top from above and a wall from the side', () => {
    const prism = { ring: square(0, 0), base: 0, top: 1 }
    const down: Ray = { origin: [0.5, 0.5, 3], direction: [0, 0, -1] }
    expect(rayPrismDistance(down, prism)).toBeCloseTo(2)
    const side: Ray = { origin: [-2, 0.5, 0.5], direction: [1, 0, 0] }
    expect(rayPrismDistance(side, prism)).toBeCloseTo(2)
    const miss: Ray = { origin: [5, 5, 3], direction: [0, 0, -1] }
    expect(rayPrismDistance(miss, prism)).toBeNull()
  })

  it('misses a wall above the top or below the base', () => {
    const prism = { ring: square(0, 0), base: 1, top: 2 }
    const low: Ray = { origin: [-2, 0.5, 0.5], direction: [1, 0, 0] }
    expect(rayPrismDistance(low, prism)).toBeNull()
  })

  it('tells points inside a ring from points outside', () => {
    expect(insideRing(square(0, 0), 0.5, 0.5)).toBe(true)
    expect(insideRing(square(0, 0), 1.5, 0.5)).toBe(false)
  })
})

describe('sortByDistance', () => {
  it('puts the building in front first, whatever order MapLibre gave (M3)', () => {
    // Looking along +x and down: the near building at x 2..3, a taller one
    // behind it at x 4..5 whose walls the ray also meets; the ground at x 7.
    const ray: Ray = { origin: [0, 0.5, 2], direction: [7, 0, -2] }
    const front = {
      id: 'front',
      prism: { ring: square(2, 0), base: 0, top: 2 },
    }
    const behind = {
      id: 'behind',
      prism: { ring: square(4, 0), base: 0, top: 5 },
    }
    const flat = { id: 'grid', prism: null }
    const sorted = sortByDistance([behind, flat, front], ray, (item) =>
      item.prism === null ? null : item.prism,
    )
    expect(sorted.map((item) => item.id)).toEqual(['front', 'behind', 'grid'])
  })

  it('puts the top storey of a stack first when seen from above (M2)', () => {
    const ring = square(0, 0)
    const storeys = [1, 2, 3, 4].map((floor) => ({
      floor,
      prism: { ring, base: floor - 1, top: floor },
    }))
    const ray: Ray = { origin: [0.5, 0.2, 10], direction: [0, 0.05, -1] }
    // MapLibre's order: the bottom storey first.
    const sorted = sortByDistance(storeys, ray, (item) => item.prism)
    expect(sorted.map((item) => item.floor)).toEqual([4, 3, 2, 1])
  })
})

describe('pointerRay', () => {
  const view: CameraView = {
    center: [-71.0725, 42.351],
    centerElevationM: 0,
    zoom: 17.5,
    pitchDeg: 50,
    bearingDeg: -20,
    fovDeg: 36.87,
    heightPx: 800,
  }

  it('places the camera behind the centre along the bearing and above it', () => {
    const [x, y, z] = cameraPosition(view)
    const [cx, cy] = toMercator(view.center, 0)
    // Bearing -20°: the camera looks north-north-west, so it stands to the
    // south-south-east of the centre (larger y is further south).
    expect(y).toBeGreaterThan(cy)
    expect(x).toBeGreaterThan(cx)
    expect(z).toBeGreaterThan(0)
    // Straight down, the camera is above the centre.
    const [ux, uy] = cameraPosition({ ...view, pitchDeg: 0 })
    expect(ux).toBeCloseTo(cx, 12)
    expect(uy).toBeCloseTo(cy, 12)
  })

  it('reaches the ground point at t = 1', () => {
    const ground: LngLat = [-71.0724, 42.3512]
    const ray = pointerRay(view, ground)
    const target = toMercator(ground, 0)
    for (const axis of [0, 1, 2] as const) {
      expect(ray.origin[axis] + ray.direction[axis]).toBeCloseTo(
        target[axis],
        12,
      )
    }
    // A building over the ground point is met before the ground.
    const footprint: LngLat[] = [
      [-71.0725, 42.3511],
      [-71.0723, 42.3511],
      [-71.0723, 42.3513],
      [-71.0725, 42.3513],
    ]
    const distance = rayPrismDistance(ray, prismOf(footprint, 0, 20))
    expect(distance).not.toBeNull()
    expect(distance ?? 2).toBeLessThan(1)
  })
})
