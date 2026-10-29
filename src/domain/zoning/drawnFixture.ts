import { districtFootprint } from '../simulation.ts'
import type { LngLat } from '../types.ts'
import type { BuildingZoningMode } from './zoning.ts'
import type { DrawnPlan, DrawnZoneUse, DrawnZoning } from './drawn.ts'

// The demo's drawn zones (decision 0034): a hand-authored floor plan for one
// building of the bundled Back Bay footprints, the "real zoning" case. It is
// synthetic: no floor plan of the real building was used. The plan is written
// in fractions of the building's own outline, so it fits the footprint, and
// is resolved once into longitude and latitude stored with the project.

/** The building with drawn zones: a near-rectangle of about 43 by 37 m, four storeys. */
export const DRAWN_FIXTURE_BUILDING = 'B0439'

/**
 * The three neighbouring buildings the fixtures zone their own way, one per
 * case: drawn zones, each floor a zone (nine storeys), and perimeter and core
 * (three storeys whose footprint splits at the default 4.5 m depth).
 */
export const FIXTURE_ZONING_OVERRIDES: Record<string, BuildingZoningMode> = {
  [DRAWN_FIXTURE_BUILDING]: 'drawn',
  B0427: 'floors',
  B0426: 'perimeterCore',
}

export const DRAWN_FIXTURE_SOURCE =
  'Synthetic floor plan, hand-authored for this demo (no real plan was used)'

/** A zone as a rectangle of the outline's fractions: u from the east face (0) to the west (1), v from the south face (0) to the north (1). */
type Cell = {
  name: string
  use: DrawnZoneUse
  u: [number, number]
  v: [number, number]
}

const CORE: Cell = {
  name: 'core',
  use: 'core',
  u: [0.35, 0.65],
  v: [0.55, 0.8],
}
const CORRIDOR: Cell = {
  name: 'corridor',
  use: 'corridor',
  u: [0, 1],
  v: [0.42, 0.55],
}
const APARTMENTS_NORTH: Cell[] = [
  { name: 'apartment northeast', use: 'apartment', u: [0, 0.35], v: [0.55, 1] },
  { name: 'apartment northwest', use: 'apartment', u: [0.65, 1], v: [0.55, 1] },
]

/** Ground floor: shops on either side of a lobby; floors 2 and 3: four flats off a corridor; floor 4: a penthouse across the south. */
const PLAN: { fromFloor: number; toFloor: number; cells: Cell[] }[] = [
  {
    fromFloor: 1,
    toFloor: 1,
    cells: [
      CORE,
      { name: 'lobby', use: 'lobby', u: [0.35, 0.65], v: [0, 0.55] },
      {
        name: 'bike and mail room',
        use: 'service',
        u: [0.35, 0.65],
        v: [0.8, 1],
      },
      { name: 'retail east', use: 'retail', u: [0, 0.35], v: [0, 1] },
      { name: 'retail west', use: 'retail', u: [0.65, 1], v: [0, 1] },
    ],
  },
  {
    fromFloor: 2,
    toFloor: 3,
    cells: [
      CORE,
      CORRIDOR,
      {
        name: 'apartment southeast',
        use: 'apartment',
        u: [0, 0.5],
        v: [0, 0.42],
      },
      {
        name: 'apartment southwest',
        use: 'apartment',
        u: [0.5, 1],
        v: [0, 0.42],
      },
      ...APARTMENTS_NORTH,
      { name: 'laundry', use: 'service', u: [0.35, 0.65], v: [0.8, 1] },
    ],
  },
  {
    fromFloor: 4,
    toFloor: 4,
    cells: [
      CORE,
      CORRIDOR,
      { name: 'penthouse', use: 'apartment', u: [0, 1], v: [0, 0.42] },
      ...APARTMENTS_NORTH,
      { name: 'roof plant', use: 'service', u: [0.35, 0.65], v: [0.8, 1] },
    ],
  },
]

/** The outline's point at fractions (u, v) of its four corners: a bilinear map, whose straight lines stay straight. */
function at(
  corners: [LngLat, LngLat, LngLat, LngLat],
  u: number,
  v: number,
): LngLat {
  const [a, b, c, d] = corners
  const mix = (index: 0 | 1) =>
    (1 - u) * (1 - v) * a[index] +
    u * (1 - v) * b[index] +
    u * v * c[index] +
    (1 - u) * v * d[index]
  return [mix(0), mix(1)]
}

/**
 * The drawn zones the fixtures store with the project, by building id; empty
 * if the bundled footprint is not the four-cornered outline the plan was
 * written for.
 */
export function fixtureDrawnZones(): Record<string, DrawnZoning> {
  const ring = districtFootprint(DRAWN_FIXTURE_BUILDING)
  const first = ring?.[0]
  const open =
    ring &&
    first &&
    ring.at(-1)?.[0] === first[0] &&
    ring.at(-1)?.[1] === first[1]
      ? ring.slice(0, -1)
      : ring
  if (!open || open.length !== 4) return {}
  const corners = open as [LngLat, LngLat, LngLat, LngLat]
  const plans: DrawnPlan[] = PLAN.map((plan) => ({
    fromFloor: plan.fromFloor,
    toFloor: plan.toFloor,
    zones: plan.cells.map((cell) => ({
      name: cell.name,
      use: cell.use,
      outline: [
        at(corners, cell.u[0], cell.v[0]),
        at(corners, cell.u[1], cell.v[0]),
        at(corners, cell.u[1], cell.v[1]),
        at(corners, cell.u[0], cell.v[1]),
      ],
    })),
  }))
  return {
    [DRAWN_FIXTURE_BUILDING]: { source: DRAWN_FIXTURE_SOURCE, plans },
  }
}
