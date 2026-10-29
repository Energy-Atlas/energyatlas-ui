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
 * How far exploded floors open (decision 0034): each storey is lifted by this
 * share of its floor height for every storey below it, so a gap of the given
 * share opens between neighbouring storeys.
 */
export const EXPLODE_GAP_SHARE = 0.8

/**
 * Where a zoned storey is drawn: its base and top less the slab gap, lifted
 * when floors are exploded.
 */
export function storeySpan(
  floor: { number: number; bottomM: number; topM: number },
  explode: boolean,
): { base: number; top: number } {
  const height = floor.topM - floor.bottomM
  const lift = explode ? (floor.number - 1) * height * EXPLODE_GAP_SHARE : 0
  const round = (value: number) => Math.round(value * 100) / 100
  return {
    base: round(floor.bottomM + lift),
    top: round(Math.max(floor.bottomM, floor.topM - slabGap(height)) + lift),
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
    selected: boolean
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
   * The selected floor or zone's floor: in 3D, the selected building's
   * floors above it are cut away so its plan shows. Null when the selection
   * is a building or a whole-building zone.
   */
  cutAbove: number | null
  /** The cut building and the height it is cut at, for the 3D outline. */
  cut: { buildingId: string; topM: number } | null
  /** What the zones are, for the legend. */
  kinds: ZoneKind[]
  /**
   * The legend's rows: each kind of zone drawn, with the colour slots its
   * drawn cells use (-1 for the core's de-emphasis colour), in drawing order.
   */
  legend: { kind: ZoneKind; slots: number[] }[]
  /** Selected buildings with no zones yet. */
  withoutZones: number
  /** Whether storeys are drawn apart (decision 0034). */
  exploded: boolean
  /** The top of each zoned building as drawn: after the cut, and lifted when exploded. */
  topsM: Record<string, number>
}

/**
 * The selected buildings' zones as one cell per zone and floor (a
 * whole-building zone has a cell on every floor), so a selected floor or zone
 * can be highlighted in 3D and a flat map can show one floor's plan.
 */
export function zoneOverlay(
  state: Pick<WorkbenchState, 'selection' | 'buildings' | 'zoning'>,
  options: { explode?: boolean } = {},
): ZoneOverlay {
  const explode = options.explode ?? false
  const topsM: Record<string, number> = {}
  const selection = state.selection
  const all = selectedBuildingIds(selection)
  const shown = all.slice(0, MAX_ZONED_BUILDINGS)
  const selectedZones = new Set(
    selection.entityType === 'zone' ? selection.ids : [],
  )
  const selectedFloors = new Set(
    selection.entityType === 'floor' ? selection.ids : [],
  )
  const focus = selection.ids[0]
  let cutAbove: number | null = null
  if (focus && selection.entityType === 'floor') {
    cutAbove = Number(focus.slice(focus.lastIndexOf(':F') + 2)) || null
  } else if (focus && selection.entityType === 'zone') {
    const zone = buildingZoning(state, ownerOf(focus))?.zones.find(
      (each) => each.id === focus,
    )
    cutAbove = zone?.floor ?? null
  }
  const cutBuilding = focus ? ownerOf(focus) : null
  const features: ZoneCell[] = []
  const buildingIds: string[] = []
  const kinds = new Set<ZoneKind>()
  const legend = new Map<ZoneKind, Set<number>>()
  let withoutZones = 0
  for (const buildingId of shown) {
    const zoning = buildingZoning(state, buildingId)
    if (!zoning) {
      withoutZones += 1
      continue
    }
    buildingIds.push(buildingId)
    for (const zone of zoning.zones) {
      kinds.add(zone.kind)
      const floors =
        zone.floor === null
          ? zoning.floors
          : zoning.floors.filter((floor) => floor.number === zone.floor)
      for (const floor of floors) {
        if (
          cutAbove !== null &&
          buildingId === cutBuilding &&
          floor.number > cutAbove
        ) {
          continue
        }
        const span = storeySpan(floor, explode)
        topsM[buildingId] = Math.max(topsM[buildingId] ?? 0, span.top)
        const slots = legend.get(zone.kind) ?? new Set<number>()
        slots.add(zone.colorSlot ?? -1)
        legend.set(zone.kind, slots)
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
            selected:
              selectedZones.has(zone.id) || selectedFloors.has(floor.id),
            base: span.base,
            top: span.top,
          },
          geometry: { type: 'Polygon', coordinates: [zone.plan] },
        })
      }
    }
  }
  return {
    cells: { type: 'FeatureCollection', features },
    buildingIds,
    omitted: all.length - shown.length,
    planFloor: cutAbove ?? 1,
    cutAbove,
    cut:
      cutAbove !== null && cutBuilding
        ? {
            buildingId: cutBuilding,
            topM: cutTop(
              buildingFloors(state, cutBuilding).find(
                (floor) => floor.number === cutAbove,
              ),
              explode,
            ),
          }
        : null,
    kinds: [...kinds],
    legend: [...legend].map(([kind, slots]) => ({
      kind,
      slots: [...slots].sort((a, b) => a - b),
    })),
    withoutZones,
    exploded: explode,
    topsM,
  }
}

/** The top of the cut storey as drawn (its slab top when exploded). */
function cutTop(
  floor: { number: number; bottomM: number; topM: number } | undefined,
  explode: boolean,
): number {
  if (!floor) return 0
  return explode ? storeySpan(floor, true).top : floor.topM
}

/**
 * The edges of zone cells in 3D (decision 0034), as segments of
 * [longitude, latitude, metres] pairs flattened six numbers a segment: every
 * cell's outline at its base and top, and one upright per corner. Selected
 * cells' edges are kept apart so they take the selection colour.
 */
export type ZoneEdges = {
  buildingId: string
  /** The building's footprint centroid, where terrain lifts it. */
  anchor: LngLat
  edges: number[]
  selected: number[]
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
        edges: [],
        selected: [],
      }
      byBuilding.set(cell.properties.buildingId, entry)
    }
    const target = cell.properties.selected ? entry.selected : entry.edges
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
