import type { LngLat, WorkbenchState } from '../../domain/types.ts'
import {
  buildingFloors,
  buildingZoning,
  ownerOf,
  selectedBuildingIds,
  type ZoneKind,
} from '../../domain/zoning/zoning.ts'
import { METRICS, type MetricId, type MetricValues } from './mapMetrics.ts'
import { metricProperty } from './StackLayer.tsx'

// GeoJSON for floors and zones on the map (decision 0032, stage 6): every
// building's floor slabs, and the zones of the selected buildings only, so
// the geometry stays bounded without the 10,000-building benchmark.

/** Most buildings whose zones the map draws at once. */
export const MAX_ZONED_BUILDINGS = 20

/** The vertical gap left between slabs so floors read apart, in metres. */
function slabGap(floorHeightM: number): number {
  return Math.min(0.35, floorHeightM * 0.1)
}

/**
 * Where a zoned storey is drawn: at its own height, its top less the slab
 * gap (decision 0035 keeps every storey in place).
 */
export function storeySpan(floor: {
  number: number
  bottomM: number
  topM: number
}): { base: number; top: number } {
  const height = floor.topM - floor.bottomM
  const round = (value: number) => Math.round(value * 100) / 100
  return {
    base: round(floor.bottomM),
    top: round(Math.max(floor.bottomM, floor.topM - slabGap(height))),
  }
}

type Polygon = { type: 'Polygon'; coordinates: LngLat[][] }

export type SlabFeature = {
  type: 'Feature'
  properties: Record<string, string | number> & {
    id: string
    floorId: string
    base: number
    top: number
  }
  geometry: Polygon
}

/**
 * One slab per floor of every building with a height: its base and top less
 * a small gap, with the building's metric values for colouring.
 */
export function slabFeatures(
  state: Pick<WorkbenchState, 'buildingIds' | 'buildings' | 'zoning'>,
  metrics: Record<MetricId, MetricValues>,
): { type: 'FeatureCollection'; features: SlabFeature[] } {
  const features: SlabFeature[] = []
  for (const id of state.buildingIds) {
    const building = state.buildings[id]
    if (!building) continue
    const floors = buildingFloors(state, id)
    if (floors.length === 0) continue
    const values = Object.fromEntries(
      METRICS.map((metric) => [
        metricProperty(metric.id),
        metrics[metric.id].values[id] ?? -1,
      ]),
    )
    for (const floor of floors) {
      const gap = slabGap(floor.topM - floor.bottomM)
      features.push({
        type: 'Feature',
        properties: {
          ...values,
          id,
          name: building.name,
          floorId: floor.id,
          base: floor.bottomM,
          top: Math.max(floor.bottomM, floor.topM - gap),
        },
        geometry: { type: 'Polygon', coordinates: [building.footprint] },
      })
    }
  }
  return { type: 'FeatureCollection', features }
}

/**
 * How a zone cell is drawn (decision 0035): every zone of a selected
 * building in its colour (`zone`); with a floor or zone selected, the
 * selected floor solid (`floor`), the selected zone highlighted and the
 * floor's other zones muted (`selected`, `muted`), and the building's other
 * floors hollow (`hollow`).
 */
export type CellState = 'zone' | 'floor' | 'selected' | 'muted' | 'hollow'

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
  /** Buildings whose zones are drawn; their slabs and extrusions are hidden. */
  buildingIds: string[]
  /** Selected buildings whose zones are not drawn, beyond the limit. */
  omitted: number
  /** The floor a flat map shows: the selected floor or zone's, else the ground floor. */
  planFloor: number
  /**
   * The building and floors a selected floor or zone is on, and the level
   * selected; null when buildings (or whole-building zones) are selected.
   */
  focus: {
    buildingId: string
    floors: number[]
    level: 'floor' | 'zone'
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
 * floor's plan. Geometry never moves: every cell keeps its storey's height.
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
  for (const buildingId of shown) {
    const zoning = buildingZoning(state, buildingId)
    if (!zoning) {
      withoutZones += 1
      continue
    }
    buildingIds.push(buildingId)
    const focusFloors = floorsByBuilding.get(buildingId)
    for (const zone of zoning.zones) {
      kinds.add(zone.kind)
      const floors =
        zone.floor === null
          ? zoning.floors
          : zoning.floors.filter((floor) => floor.number === zone.floor)
      for (const floor of floors) {
        const onFocus = focusFloors?.has(floor.number) ?? false
        const cellState: CellState = !focusFloors
          ? 'zone'
          : !onFocus
            ? 'hollow'
            : !zoneLevel
              ? 'floor'
              : selectedZones.has(zone.id)
                ? 'selected'
                : 'muted'
        if (cellState === 'hollow') hollow = true
        else {
          const slots = legend.get(zone.kind) ?? new Set<number>()
          slots.add(zone.colorSlot ?? -1)
          legend.set(zone.kind, slots)
        }
        const span = storeySpan(floor)
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
            base: span.base,
            top: span.top,
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
        : null,
    hollow,
    kinds: [...kinds],
    legend: [...legend].map(([kind, slots]) => ({
      kind,
      slots: [...slots].sort((a, b) => a - b),
    })),
    withoutZones,
  }
}

/** Which edges a cell's outline joins, by how it is drawn. */
export type EdgeStyle = 'zone' | 'focus' | 'selected' | 'hollow'

const EDGE_STYLE: Record<CellState, EdgeStyle> = {
  zone: 'zone',
  floor: 'focus',
  selected: 'selected',
  muted: 'focus',
  hollow: 'hollow',
}

/**
 * The edges of zone cells in 3D (decisions 0034 and 0035), as segments of
 * [longitude, latitude, metres] pairs flattened six numbers a segment: every
 * cell's outline at its base and top, and one upright per corner, grouped by
 * how they are drawn: ordinary zone edges, the emphasised edges of a
 * selected floor, the selected zone's, and the thin edges of hollow floors.
 */
export type ZoneEdges = {
  buildingId: string
  /**
   * Where terrain is sampled to lift the building's edges: the mean vertex of
   * its first zone cell, near but not the footprint centroid MapLibre lifts
   * extrusions by, so on steep terrain edges can sit slightly off.
   */
  anchor: LngLat
  edges: Record<EdgeStyle, number[]>
}

export function zoneEdges(cells: ZoneCell[]): ZoneEdges[] {
  const byBuilding = new Map<string, ZoneEdges>()
  for (const cell of cells) {
    const ring = cell.geometry.coordinates[0] ?? []
    const first = ring[0]
    const last = ring.at(-1)
    const open =
      first && last && first[0] === last[0] && first[1] === last[1]
        ? ring.slice(0, -1)
        : ring
    if (open.length < 3) continue
    let entry = byBuilding.get(cell.properties.buildingId)
    if (!entry) {
      const count = open.length
      entry = {
        buildingId: cell.properties.buildingId,
        anchor: [
          open.reduce((sum, point) => sum + point[0], 0) / count,
          open.reduce((sum, point) => sum + point[1], 0) / count,
        ],
        edges: { zone: [], focus: [], selected: [], hollow: [] },
      }
      byBuilding.set(cell.properties.buildingId, entry)
    }
    const target = entry.edges[EDGE_STYLE[cell.properties.state]]
    const { base, top } = cell.properties
    open.forEach((point, index) => {
      const next = open[(index + 1) % open.length] ?? point
      target.push(point[0], point[1], base, next[0], next[1], base)
      target.push(point[0], point[1], top, next[0], next[1], top)
      target.push(point[0], point[1], base, point[0], point[1], top)
    })
  }
  return [...byBuilding.values()]
}
