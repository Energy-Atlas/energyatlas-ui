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
import { buildFixture } from '../../server/fixtures.ts'
import { clickTarget, type MapHit } from './mapSelection.ts'
import { toMercator } from './silhouette.ts'
import { zoneOverlay } from './zoneFeatures.ts'

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

describe('a click on a selected floor (M2)', () => {
  const NOW = () => new Date('2026-10-29T12:00:00Z')
  const complete = buildFixture('complete', NOW)
  const state = {
    ...complete,
    selection: { entityType: 'floor' as const, ids: ['B0439:F2'] },
  }
  const cells = zoneOverlay(state).cells.features

  /** A click from a tilted camera straight at the middle of a zone's top on floor 2. */
  function clickOn(zoneId: string) {
    const cell = cells.find(
      (each) => each.properties.id === zoneId && each.properties.floor === 2,
    )
    if (!cell) throw new Error(`No cell ${zoneId}.`)
    const ring = (cell.geometry.coordinates[0] ?? []).slice(0, -1)
    const middle: LngLat = [
      ring.reduce((sum, point) => sum + point[0], 0) / ring.length,
      ring.reduce((sum, point) => sum + point[1], 0) / ring.length,
    ]
    const top = toMercator(middle, cell.properties.top)
    const ground = toMercator(middle, 0)
    // The camera stands 300 m up and to the south, looking through the
    // middle of the zone's top down to the ground beyond it.
    const origin = toMercator([middle[0], middle[1] - 0.002], 300)
    const scale = (ground[2] - origin[2]) / (top[2] - origin[2])
    const ray = {
      origin,
      direction: [
        (top[0] - origin[0]) * scale,
        (top[1] - origin[1]) * scale,
        ground[2] - origin[2],
      ] as [number, number, number],
    }
    // MapLibre's order: the cells in source order, the bottom floor first.
    const sorted = sortByDistance(
      cells.filter(
        (each) =>
          rayPrismDistance(
            ray,
            prismOf(
              each.geometry.coordinates[0] ?? [],
              each.properties.base,
              each.properties.top,
            ),
          ) !== null,
      ),
      ray,
      (each) =>
        prismOf(
          each.geometry.coordinates[0] ?? [],
          each.properties.base,
          each.properties.top,
        ),
    )
    const hits: MapHit[] = sorted.map((each) => ({
      kind: 'building',
      buildingId: 'B0439',
      floor: each.properties.floor,
      zoneId: each.properties.id,
    }))
    return clickTarget(state, hits)
  }

  it('selects the zone under the pointer, wherever on the floor the click lands', () => {
    expect(clickOn('B0439:F2:Z2')).toEqual({
      entityType: 'zone',
      ids: ['B0439:F2:Z2'],
    })
    expect(clickOn('B0439:F2:Z3')).toEqual({
      entityType: 'zone',
      ids: ['B0439:F2:Z3'],
    })
    expect(clickOn('B0439:F2:Z7')).toEqual({
      entityType: 'zone',
      ids: ['B0439:F2:Z7'],
    })
  })
})
