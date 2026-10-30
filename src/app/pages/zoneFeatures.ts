import type { LngLat, WorkbenchState } from '../../domain/types.ts'
import {
  buildingZoning,
  ownerOf,
  selectedBuildingIds,
  type ZoneKind,
} from '../../domain/zoning/zoning.ts'

// GeoJSON for zones on the map (decision 0032, stage 6; decision 0036): the
// zones of the selected buildings only, so the geometry stays bounded
// without the 10,000-building benchmark. Zones are the backend's geometry
// (decision 0036); every storey is drawn at its own height, from its floor
// to the next, so a building's zone volumes make up its extrusion exactly.

/** Most buildings whose zones the map draws at once. */
export const MAX_ZONED_BUILDINGS = 20

type Polygon = { type: 'Polygon'; coordinates: LngLat[][] }

/**
 * How a zone cell is drawn (decision 0035, changed by decision 0036): every
 * zone of a selected building in its colour (`zone`); with a floor or zone
 * selected, the selected floor solid (`floor`) with the selected zone marked
 * by its edges in the selection colour (`selected`) while the floor's other
 * zones keep their colours, and the building's other floors hollow
 * (`hollow`). A selected whole-building zone is marked on every storey.
 */
export type CellState = 'zone' | 'floor' | 'selected' | 'hollow'

export type ZoneCell = {
  type: 'Feature'
  properties: {
    /** The zone's id: clicking a cell selects its zone. */
    id: string
    floorId: string
    buildingId: string
    name: string
    kind: ZoneKind
    floor: number
    /** 0 to 2 for the categorical slots, -1 for the core. */
    colorSlot: number
    /** A selected zone, or a cell on a selected floor (the flat map's outline). */
    selected: boolean
    state: CellState
    base: number
    top: number
  }
  geometry: Polygon
}

export type ZoneOverlay = {
  cells: { type: 'FeatureCollection'; features: ZoneCell[] }
  /** Buildings whose zones are drawn; their extrusions are hidden. */
  buildingIds: string[]
  /** Selected buildings whose zones are not drawn, beyond the limit. */
  omitted: number
  /** The floor a flat map shows: the selected floor or zone's, else the ground floor. */
  planFloor: number
  /**
   * The building and floors a selected floor or zone is on, and the level
   * selected (`building zone` for a whole-building zone, on every floor);
   * null when buildings are selected.
   */
  focus: {
    buildingId: string
    floors: number[]
    level: 'floor' | 'zone' | 'building zone'
  } | null
  /** Whether some floors are drawn hollow in 3D. */
  hollow: boolean
  /** What the zones are, for the legend. */
  kinds: ZoneKind[]
  /**
   * The legend's rows: each kind of zone drawn, with the colour slots its
   * drawn cells use (-1 for the core's de-emphasis colour), in drawing order.
   */
  legend: { kind: ZoneKind; slots: number[] }[]
  /** Whether a drawn building's zones come from the backend's zone geometry. */
  geometry: boolean
  /** Selected buildings with no zones yet. */
  withoutZones: number
}

/** The floor number of a floor id, `<building>:F<n>`. */
export function floorNumberOf(floorId: string): number | null {
  const match = /:F(\d+)$/.exec(floorId)
  return match ? Number(match[1]) : null
}

/**
 * The floors selected in each building: selected floors, or the floors of
 * selected zones. A whole-building zone selects no single floor, so its
 * building shows every floor.
 */
export function selectedFloorsByBuilding(
  state: Pick<WorkbenchState, 'selection' | 'buildings' | 'zoning'>,
): Map<string, Set<number>> {
  const { selection } = state
  const byBuilding = new Map<string, Set<number>>()
  const add = (buildingId: string, floor: number) => {
    const floors = byBuilding.get(buildingId) ?? new Set<number>()
    floors.add(floor)
    byBuilding.set(buildingId, floors)
  }
  if (selection.entityType === 'floor') {
    for (const id of selection.ids) {
      const number = floorNumberOf(id)
      if (number !== null) add(ownerOf(id), number)
    }
  } else if (selection.entityType === 'zone') {
    for (const id of selection.ids) {
      const zone = buildingZoning(state, ownerOf(id))?.zones.find(
        (each) => each.id === id,
      )
      if (zone && zone.floor !== null) add(ownerOf(id), zone.floor)
    }
  }
  return byBuilding
}

/**
 * The selected buildings' zones as one cell per zone and floor (a
 * whole-building zone has a cell on every floor), so a selected floor or zone
 * can be shown solid among hollow floors in 3D and a flat map can show one
 * floor's plan. Geometry never moves: every cell spans its storey exactly.
 */
export function zoneOverlay(
  state: Pick<WorkbenchState, 'selection' | 'buildings' | 'zoning'>,
): ZoneOverlay {
  const selection = state.selection
  const all = selectedBuildingIds(selection)
  const shown = all.slice(0, MAX_ZONED_BUILDINGS)
  const selectedZones = new Set(
    selection.entityType === 'zone' ? selection.ids : [],
  )
  const zoneLevel = selection.entityType === 'zone'
  const floorsByBuilding = selectedFloorsByBuilding(state)
  const features: ZoneCell[] = []
  const buildingIds: string[] = []
  const kinds = new Set<ZoneKind>()
  const legend = new Map<ZoneKind, Set<number>>()
  let withoutZones = 0
  let hollow = false
  let geometry = false
  for (const buildingId of shown) {
    const zoning = buildingZoning(state, buildingId)
    if (!zoning) {
      withoutZones += 1
      continue
    }
    buildingIds.push(buildingId)
    if (zoning.source === 'geometry') geometry = true
    const focusFloors = floorsByBuilding.get(buildingId)
    for (const zone of zoning.zones) {
      kinds.add(zone.kind)
      const floors =
        zone.floor === null
          ? zoning.floors
          : zoning.floors.filter((floor) => floor.number === zone.floor)
      for (const floor of floors) {
        const onFocus = focusFloors?.has(floor.number) ?? false
        const cellState: CellState = selectedZones.has(zone.id)
          ? 'selected'
          : !focusFloors
            ? 'zone'
            : onFocus
              ? 'floor'
              : 'hollow'
        if (cellState === 'hollow') hollow = true
        else {
          const slots = legend.get(zone.kind) ?? new Set<number>()
          slots.add(zone.colorSlot ?? -1)
          legend.set(zone.kind, slots)
        }
        features.push({
          type: 'Feature',
          properties: {
            id: zone.id,
            floorId: floor.id,
            buildingId,
            name: zone.name,
            kind: zone.kind,
            floor: floor.number,
            colorSlot: zone.colorSlot ?? -1,
            selected: selectedZones.has(zone.id) || (!zoneLevel && onFocus),
            state: cellState,
            base: floor.bottomM,
            top: floor.topM,
          },
          geometry: { type: 'Polygon', coordinates: [zone.plan] },
        })
      }
    }
  }
  // The flat map and the legend follow the first selected floor or zone.
  const first = selection.ids[0]
  const focusBuilding =
    first && (selection.entityType === 'floor' || zoneLevel)
      ? ownerOf(first)
      : null
  const focusFloors = focusBuilding ? floorsByBuilding.get(focusBuilding) : null
  const floors = focusFloors ? [...focusFloors].sort((a, b) => a - b) : []
  // A whole-building zone selected: its building, on every floor.
  const wholeZone =
    focusBuilding && !focusFloors && zoneLevel
      ? (buildingZoning(state, focusBuilding)?.zones.find(
          (zone) => zone.floor === null && selectedZones.has(zone.id),
        ) ?? null)
      : null
  const wholeFloors = wholeZone
    ? (buildingZoning(state, focusBuilding ?? '')?.floors ?? []).map(
        (floor) => floor.number,
      )
    : []
  return {
    cells: { type: 'FeatureCollection', features },
    buildingIds,
    omitted: all.length - shown.length,
    planFloor: floors[0] ?? 1,
    focus:
      focusBuilding && floors.length > 0
        ? {
            buildingId: focusBuilding,
            floors,
            level: zoneLevel ? 'zone' : 'floor',
          }
        : focusBuilding && wholeZone
          ? {
              buildingId: focusBuilding,
              floors: wholeFloors,
              level: 'building zone',
            }
          : null,
    hollow,
    kinds: [...kinds],
    legend: [...legend].map(([kind, slots]) => ({
      kind,
      slots: [...slots].sort((a, b) => a - b),
    })),
    geometry,
    withoutZones,
  }
}

/**
 * How an edge is drawn, by the most prominent cell it bounds: ordinary zone
 * edges, the emphasised edges of a selected floor, a selected zone's, and
 * the thin edges of hollow floors.
 */
export type EdgeStyle = 'zone' | 'focus' | 'selected' | 'hollow'

/**
 * What an edge is (decision 0036): the building's envelope (its outline at
 * the ground and the roof, and its corners), or a boundary between zones,
 * drawn in a colour of its own.
 */
export type EdgeRole = 'envelope' | 'boundary'

const STYLE_RANK: Record<EdgeStyle, number> = {
  hollow: 0,
  zone: 1,
  focus: 2,
  selected: 3,
}

const EDGE_STYLE: Record<CellState, EdgeStyle> = {
  zone: 'zone',
  floor: 'focus',
  selected: 'selected',
  hollow: 'hollow',
}

/**
 * The edges of zone cells in 3D (decisions 0034 to 0036), each drawn once, as
 * segments of [longitude, latitude, metres] pairs flattened six numbers a
 * segment, grouped by style and role.
 */
export type ZoneEdges = {
  buildingId: string
  /** Where terrain is sampled to lift the building's edges: its footprint's mean corner. */
  anchor: LngLat
  parts: { style: EdgeStyle; role: EdgeRole; segments: number[] }[]
}

const METERS_PER_DEGREE = 111_320
/** Points closer than this, in metres, are one point; lines within it are one line. */
const TOLERANCE_M = 0.01

function openRing(ring: LngLat[]): LngLat[] {
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

type Plane = { x: (point: LngLat) => number; y: (point: LngLat) => number }

function planeOf(origin: LngLat): Plane {
  const perLng = METERS_PER_DEGREE * Math.cos((origin[1] * Math.PI) / 180)
  return {
    x: (point) => (point[0] - origin[0]) * perLng,
    y: (point) => (point[1] - origin[1]) * METERS_PER_DEGREE,
  }
}

/** How far along a–b the point p lies (0 to 1), when it lies on the segment; else null. */
function along(plane: Plane, a: LngLat, b: LngLat, p: LngLat): number | null {
  const ax = plane.x(a)
  const ay = plane.y(a)
  const dx = plane.x(b) - ax
  const dy = plane.y(b) - ay
  const length2 = dx * dx + dy * dy
  if (length2 === 0) return null
  const px = plane.x(p) - ax
  const py = plane.y(p) - ay
  const t = (px * dx + py * dy) / length2
  const offset = Math.abs(px * dy - py * dx) / Math.sqrt(length2)
  return offset <= TOLERANCE_M ? t : null
}

const keyOf = ([lng, lat]: LngLat) => `${lng.toFixed(9)},${lat.toFixed(9)}`

/** The corners of a footprint where its outline turns by more than ten degrees. */
function cornersOf(plane: Plane, ring: LngLat[]): Set<string> {
  const corners = new Set<string>()
  ring.forEach((point, index) => {
    const before = ring[(index - 1 + ring.length) % ring.length] ?? point
    const after = ring[(index + 1) % ring.length] ?? point
    const ux = plane.x(point) - plane.x(before)
    const uy = plane.y(point) - plane.y(before)
    const vx = plane.x(after) - plane.x(point)
    const vy = plane.y(after) - plane.y(point)
    const turn = Math.abs(Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy))
    if (turn > (10 * Math.PI) / 180) corners.add(keyOf(point))
  })
  return corners
}

type EdgeEntry = {
  a: LngLat
  b: LngLat
  zA: number
  zB: number
  zones: Set<string>
  style: EdgeStyle
  onOutline: boolean
  vertical: boolean
}

/**
 * Each building's zone edges, every boundary once: horizontal edges at each
 * storey level are split at every corner on them (so neighbours' outlines
 * that split a wall differently give one line), then kept when they are the
 * building's outline at the ground or the roof (envelope) or when they part
 * two zones (boundary: between neighbours on a floor, or between a zone and
 * the one above it); uprights at the footprint's corners are envelope
 * edges, and uprights elsewhere are boundaries where two zones meet.
 */
export function zoneEdges(
  cells: ZoneCell[],
  footprints: Record<string, LngLat[] | undefined>,
): ZoneEdges[] {
  const byBuilding = new Map<string, ZoneCell[]>()
  for (const cell of cells) {
    const list = byBuilding.get(cell.properties.buildingId) ?? []
    list.push(cell)
    byBuilding.set(cell.properties.buildingId, list)
  }
  const result: ZoneEdges[] = []
  for (const [buildingId, own] of byBuilding) {
    const footprint = openRing(footprints[buildingId] ?? [])
    const origin = footprint[0] ?? own[0]?.geometry.coordinates[0]?.[0]
    if (!origin) continue
    const plane = planeOf(origin)
    const corners = cornersOf(plane, footprint)
    const onOutline = (a: LngLat, b: LngLat) =>
      footprint.some((point, index) => {
        const next = footprint[(index + 1) % footprint.length] ?? point
        const ta = along(plane, point, next, a)
        const tb = along(plane, point, next, b)
        const slack = 1e-6
        return (
          ta !== null &&
          tb !== null &&
          ta >= -slack &&
          ta <= 1 + slack &&
          tb >= -slack &&
          tb <= 1 + slack
        )
      })
    const roof = Math.max(...own.map((cell) => cell.properties.top))
    const entries = new Map<string, EdgeEntry>()
    const add = (
      key: string,
      make: () => Omit<EdgeEntry, 'zones' | 'style'>,
      cell: ZoneCell,
    ) => {
      let entry = entries.get(key)
      if (!entry) {
        entry = { ...make(), zones: new Set(), style: 'hollow' }
        entries.set(key, entry)
      }
      entry.zones.add(cell.properties.id)
      const style = EDGE_STYLE[cell.properties.state]
      if (STYLE_RANK[style] > STYLE_RANK[entry.style]) entry.style = style
    }
    // Every corner at each level, to split the edges there.
    const levels = new Map<number, LngLat[]>()
    const ringOf = (cell: ZoneCell) =>
      openRing(cell.geometry.coordinates[0] ?? [])
    for (const cell of own) {
      for (const level of [cell.properties.base, cell.properties.top]) {
        const points = levels.get(level) ?? []
        points.push(...ringOf(cell))
        levels.set(level, points)
      }
    }
    for (const cell of own) {
      const ring = ringOf(cell)
      if (ring.length < 3) continue
      const { base, top } = cell.properties
      for (const level of [base, top]) {
        const points = levels.get(level) ?? []
        ring.forEach((a, index) => {
          const b = ring[(index + 1) % ring.length] ?? a
          // Split a–b at every corner of this level that lies on it.
          const stops = new Map<string, { t: number; point: LngLat }>()
          stops.set(keyOf(a), { t: 0, point: a })
          stops.set(keyOf(b), { t: 1, point: b })
          for (const point of points) {
            const t = along(plane, a, b, point)
            if (t !== null && t > 1e-6 && t < 1 - 1e-6) {
              stops.set(keyOf(point), { t, point })
            }
          }
          const ordered = [...stops.values()].sort((p, q) => p.t - q.t)
          for (let step = 0; step + 1 < ordered.length; step += 1) {
            const p = ordered[step]?.point
            const q = ordered[step + 1]?.point
            if (!p || !q) continue
            const [first, second] = [keyOf(p), keyOf(q)].sort()
            add(
              `h|${level}|${first}|${second}`,
              () => ({
                a: p,
                b: q,
                zA: level,
                zB: level,
                onOutline: onOutline(p, q),
                vertical: false,
              }),
              cell,
            )
          }
        })
      }
      for (const point of ring) {
        add(
          `v|${keyOf(point)}|${base}|${top}`,
          () => ({
            a: point,
            b: point,
            zA: base,
            zB: top,
            onOutline: corners.has(keyOf(point)),
            vertical: true,
          }),
          cell,
        )
      }
    }
    const parts = new Map<
      string,
      { style: EdgeStyle; role: EdgeRole; segments: number[] }
    >()
    for (const entry of entries.values()) {
      const envelope = entry.vertical
        ? entry.onOutline
        : entry.onOutline && (entry.zA === 0 || entry.zA === roof)
      const parting = entry.zones.size >= 2
      if (!envelope && !parting) continue
      const role: EdgeRole = envelope ? 'envelope' : 'boundary'
      const key = `${entry.style}|${role}`
      let part = parts.get(key)
      if (!part) {
        part = { style: entry.style, role, segments: [] }
        parts.set(key, part)
      }
      part.segments.push(
        entry.a[0],
        entry.a[1],
        entry.zA,
        entry.b[0],
        entry.b[1],
        entry.zB,
      )
    }
    const count = footprint.length || 1
    result.push({
      buildingId,
      anchor: [
        footprint.reduce((sum, point) => sum + point[0], 0) / count,
        footprint.reduce((sum, point) => sum + point[1], 0) / count,
      ],
      parts: [...parts.values()].sort(
        (p, q) =>
          STYLE_RANK[p.style] - STYLE_RANK[q.style] ||
          (p.role === q.role ? 0 : p.role === 'envelope' ? 1 : -1),
      ),
    })
  }
  return result
}
