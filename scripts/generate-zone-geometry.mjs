// Generates src/domain/fixtures/zone-geometry.json: precomputed zone geometry
// for a few buildings of the bundled Back Bay footprints, standing in for
// what the backend's zoning will deliver (decision 0036). The browser only
// displays it; nothing zones a building at runtime.
//
// Run: node scripts/generate-zone-geometry.mjs
//
// Every zone outline is written so that the zones of a floor tile the
// footprint exactly: footprint corners are copied unchanged, every corner a
// zone shares with a neighbour is the same pair of numbers in both outlines,
// and a corner of one zone that lies on another zone's wall is inserted into
// that wall too, so no wall has a T-junction. The three cases are synthetic:
//
// - B0439: a hand-authored mixed-use floor plan (shops and a lobby below,
//   flats above, a penthouse on top), written in fractions of the four-cornered
//   outline and mapped bilinearly, whose straight lines stay straight.
// - B0427: each floor a zone, the footprint itself.
// - B0426: perimeter and core at a 4.5 m depth, RC's zoned formation test
//   depth: a core inset from every edge by the depth, and one perimeter zone
//   per edge between the footprint and the core, split along the bisectors.

import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import prettier from 'prettier'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const footprints = JSON.parse(
  readFileSync(
    join(root, 'src/domain/fixtures/back-bay-buildings.geo.json'),
    'utf8',
  ),
)
const OUTPUT = join(root, 'src/domain/fixtures/zone-geometry.json')

const SOURCE =
  'Synthetic zone geometry precomputed for this demo, standing in for the backend (no real floor plan was used)'

/** The storeys the fixtures give each building (floors × 3.2 m tall). */
const STOREYS = { B0439: 4, B0427: 9, B0426: 3 }

function openRing(id) {
  const index = Number(id.slice(1)) - 1
  const ring = footprints.features[index].geometry.coordinates[0]
  const first = ring[0]
  const last = ring.at(-1)
  return first[0] === last[0] && first[1] === last[1] ? ring.slice(0, -1) : ring
}

// --- B0439: the drawn mixed-use plan --------------------------------------

/** u from the east face (0) to the west (1), v from the south face (0) to the north (1). */
const CORE = { name: 'core', use: 'core', u: [0.35, 0.65], v: [0.55, 0.8] }
const CORRIDOR = {
  name: 'corridor',
  use: 'corridor',
  u: [0, 1],
  v: [0.42, 0.55],
}
const APARTMENTS_NORTH = [
  { name: 'apartment northeast', use: 'apartment', u: [0, 0.35], v: [0.55, 1] },
  { name: 'apartment northwest', use: 'apartment', u: [0.65, 1], v: [0.55, 1] },
]
const DRAWN_PLAN = [
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

/** The outline's point at fractions (u, v) of its four corners. */
function bilinear([a, b, c, d], u, v) {
  const mix = (index) =>
    (1 - u) * (1 - v) * a[index] +
    u * (1 - v) * b[index] +
    u * v * c[index] +
    (1 - u) * v * d[index]
  return [mix(0), mix(1)]
}

/**
 * A cell's corners in (u, v), counter to the footprint's own order, with
 * every other cell's corner that lies on one of its edges inserted.
 */
function cellRing(cell, corners) {
  const [u0, u1] = cell.u
  const [v0, v1] = cell.v
  const sides = [
    // From (u0, v0) to (u1, v0), then up, then back, then down.
    { fixed: 'v', at: v0, from: u0, to: u1 },
    { fixed: 'u', at: u1, from: v0, to: v1 },
    { fixed: 'v', at: v1, from: u1, to: u0 },
    { fixed: 'u', at: u0, from: v1, to: v0 },
  ]
  const ring = []
  for (const side of sides) {
    const between = corners
      .filter(([u, v]) => {
        const along = side.fixed === 'v' ? u : v
        const across = side.fixed === 'v' ? v : u
        const low = Math.min(side.from, side.to)
        const high = Math.max(side.from, side.to)
        return across === side.at && along > low && along < high
      })
      .map(([u, v]) => (side.fixed === 'v' ? u : v))
    const unique = [...new Set(between)].sort((p, q) =>
      side.to > side.from ? p - q : q - p,
    )
    const start =
      side.fixed === 'v' ? [side.from, side.at] : [side.at, side.from]
    ring.push(start)
    for (const value of unique) {
      ring.push(side.fixed === 'v' ? [value, side.at] : [side.at, value])
    }
  }
  return ring
}

function drawnGeometry(id) {
  const ring = openRing(id)
  if (ring.length !== 4) throw new Error(`${id} is not four-cornered.`)
  return DRAWN_PLAN.map((plan) => {
    const corners = plan.cells.flatMap((cell) =>
      cell.u.flatMap((u) => cell.v.map((v) => [u, v])),
    )
    return {
      fromFloor: plan.fromFloor,
      toFloor: plan.toFloor,
      zones: plan.cells.map((cell) => ({
        name: cell.name,
        kind: 'drawn',
        use: cell.use,
        facing: null,
        outline: cellRing(cell, corners).map(([u, v]) => bilinear(ring, u, v)),
      })),
    }
  })
}

// --- B0427: each floor a zone -----------------------------------------------

function floorGeometry(id) {
  return [
    {
      fromFloor: 1,
      toFloor: STOREYS[id],
      zones: [
        {
          name: '',
          kind: 'floor',
          use: null,
          facing: null,
          outline: openRing(id),
        },
      ],
    },
  ]
}

// --- B0426: perimeter and core ----------------------------------------------

const METERS_PER_DEGREE = 111_320
const FACINGS = [
  'east',
  'northeast',
  'north',
  'northwest',
  'west',
  'southwest',
  'south',
  'southeast',
]

function signedArea(ring) {
  let sum = 0
  ring.forEach(([x1, y1], index) => {
    const [x2, y2] = ring[(index + 1) % ring.length]
    sum += x1 * y2 - x2 * y1
  })
  return sum / 2
}

function perimeterCoreGeometry(id, depth) {
  const lngLat = openRing(id)
  const [originLng, originLat] = lngLat[0]
  const perLng = METERS_PER_DEGREE * Math.cos((originLat * Math.PI) / 180)
  const toPlane = ([lng, lat]) => [
    (lng - originLng) * perLng,
    (lat - originLat) * METERS_PER_DEGREE,
  ]
  const toLngLat = ([x, y]) => [
    originLng + x / perLng,
    originLat + y / METERS_PER_DEGREE,
  ]
  const plane = lngLat.map(toPlane)
  // Inward is to the left of a counter-clockwise ring.
  const sign = signedArea(plane) > 0 ? 1 : -1
  const count = plane.length
  const offsetLine = (index) => {
    const a = plane[index]
    const b = plane[(index + 1) % count]
    const length = Math.hypot(b[0] - a[0], b[1] - a[1])
    if (length < depth)
      throw new Error(`${id} has an edge shorter than the depth.`)
    const normal = [
      (-(b[1] - a[1]) / length) * sign,
      ((b[0] - a[0]) / length) * sign,
    ]
    return {
      point: [a[0] + normal[0] * depth, a[1] + normal[1] * depth],
      direction: [b[0] - a[0], b[1] - a[1]],
    }
  }
  const intersect = (p, q) => {
    const cross =
      p.direction[0] * q.direction[1] - p.direction[1] * q.direction[0]
    const w = [q.point[0] - p.point[0], q.point[1] - p.point[1]]
    const t = (w[0] * q.direction[1] - w[1] * q.direction[0]) / cross
    return [p.point[0] + t * p.direction[0], p.point[1] + t * p.direction[1]]
  }
  // Core corner i sits where the offsets of the edges before and after
  // footprint corner i meet; the band splits along the corner bisectors.
  const core = plane.map((_, index) =>
    intersect(offsetLine((index - 1 + count) % count), offsetLine(index)),
  )
  const coreArea = Math.abs(signedArea(core))
  if (coreArea < 10 || signedArea(core) * sign <= 0) {
    throw new Error(`${id} leaves no core at ${depth} m.`)
  }
  // Coordinates are rounded once, so each shared corner is one pair of numbers.
  const round = (value) => Math.round(value * 1e9) / 1e9
  const coreLngLat = core.map((point) => toLngLat(point).map(round))
  const facingOf = (a, b) => {
    // Outward is on the right of a counter-clockwise ring.
    const dx = (b[0] - a[0]) * sign
    const dy = (b[1] - a[1]) * sign
    const angle = Math.atan2(-dx, dy)
    const octant = Math.round(angle / (Math.PI / 4))
    return FACINGS[(octant + 8) % 8]
  }
  const zones = [
    {
      name: 'core',
      kind: 'core',
      use: null,
      facing: null,
      outline: coreLngLat,
    },
    ...lngLat.map((corner, index) => {
      const next = (index + 1) % count
      return {
        name: `perimeter ${index + 1}`,
        kind: 'perimeter',
        use: null,
        facing: facingOf(plane[index], plane[next]),
        outline: [corner, lngLat[next], coreLngLat[next], coreLngLat[index]],
      }
    }),
  ]
  return [{ fromFloor: 1, toFloor: STOREYS[id], zones }]
}

const geometry = {
  B0439: { source: SOURCE, plans: drawnGeometry('B0439') },
  B0427: { source: SOURCE, plans: floorGeometry('B0427') },
  B0426: { source: SOURCE, plans: perimeterCoreGeometry('B0426', 4.5) },
}

// Written as Prettier formats JSON, so the repository's format check passes.
const text = JSON.stringify({
  note: 'Generated by scripts/generate-zone-geometry.mjs from back-bay-buildings.geo.json (ODbL, © OpenStreetMap contributors); the zones are synthetic.',
  buildings: geometry,
})
writeFileSync(OUTPUT, await prettier.format(text, { parser: 'json' }))
console.log(`Wrote ${OUTPUT}`)
