import { z } from 'zod'
import { METRICS, type MetricId } from './mapMetrics.ts'

// The map's layer stack (decision 0031): layers of the project's own objects,
// drawn in order, each shown or hidden and styled on its own. Several layers
// may draw the same source. Saved with the project.

export type MapLayerKind = 'buildings' | 'gridLines' | 'gridPoints'

/** A building layer colors by a metric or draws one color. */
export type BuildingColor = MetricId | 'single'

export type MapLayer = {
  id: string
  name: string
  kind: MapLayerKind
  visible: boolean
  /** 0 to 100. */
  opacityPercent: number
  /** Buildings only. */
  colorBy: BuildingColor
  /** Buildings only: extruded to their heights in the 3D view. */
  extrude: boolean
}

export const LAYER_KINDS: Record<
  MapLayerKind,
  { label: string; description: string }
> = {
  buildings: {
    label: 'Buildings',
    description: 'Building footprints, colored by a metric and extruded in 3D.',
  },
  gridLines: {
    label: 'Grid lines',
    description: 'Feeder lines of the grid model.',
  },
  gridPoints: {
    label: 'Grid points',
    description: 'Transformers, the substation, and utility PV.',
  },
}

export const MAP_LAYER_KINDS = Object.keys(LAYER_KINDS) as MapLayerKind[]

const METRIC_IDS = METRICS.map((metric) => metric.id) as [
  MetricId,
  ...MetricId[],
]
export const BUILDING_COLORS = [...METRIC_IDS, 'single'] as [
  BuildingColor,
  ...BuildingColor[],
]

export function colorLabel(color: BuildingColor): string {
  if (color === 'single') return 'One color'
  return METRICS.find((metric) => metric.id === color)?.label ?? color
}

export function newLayer(
  id: string,
  kind: MapLayerKind,
  name = LAYER_KINDS[kind].label,
): MapLayer {
  return {
    id,
    name,
    kind,
    visible: true,
    opacityPercent: kind === 'buildings' ? 90 : 100,
    colorBy: 'floors',
    extrude: true,
  }
}

/** The stack of a project that saved none, top first. */
export function defaultLayers(): MapLayer[] {
  return [
    newLayer('grid-points', 'gridPoints'),
    newLayer('grid-lines', 'gridLines'),
    newLayer('buildings', 'buildings'),
  ]
}

/** An id not used in the stack, numbered after its kind. */
export function nextLayerId(layers: MapLayer[], kind: MapLayerKind): string {
  const used = new Set(layers.map((layer) => layer.id))
  for (let number = 2; ; number += 1) {
    const id = `${kind}-${number}`
    if (!used.has(id)) return id
  }
}

const layerSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  kind: z.enum(MAP_LAYER_KINDS as [MapLayerKind, ...MapLayerKind[]]),
  visible: z.boolean(),
  opacityPercent: z.number().int().min(0).max(100),
  colorBy: z.enum(BUILDING_COLORS),
  extrude: z.boolean(),
  // floorSlabs (decision 0032, removed by decision 0036) and explodeFloors
  // (decision 0034, removed by decision 0035) are dropped when a stack saved
  // with them is read: zod strips unknown keys.
})

/**
 * The stack saved with a project, or the defaults when it saved none or the
 * saved one cannot be read (decision 0031).
 */
export function parseStoredLayers(value: unknown): MapLayer[] {
  return readStoredLayers(value) ?? defaultLayers()
}

/** A stored stack, or null when it cannot be read (saved layouts note this). */
export function readStoredLayers(value: unknown): MapLayer[] | null {
  const parsed = z.array(layerSchema).safeParse(value)
  if (!parsed.success) return null
  const ids = new Set(parsed.data.map((layer) => layer.id))
  return ids.size === parsed.data.length ? parsed.data : null
}

/** Whether a stack differs from what the project saved (none: the defaults). */
export function layersDiffer(current: MapLayer[], saved: unknown): boolean {
  return JSON.stringify(current) !== JSON.stringify(parseStoredLayers(saved))
}

/**
 * One muted line for the layer list: what the layer shows, when its name does
 * not say, and how. Empty for a layer shown as it starts.
 */
export function layerSummary(layer: MapLayer): string {
  const kind = LAYER_KINDS[layer.kind].label
  const parts = layer.name === kind ? [] : [kind]
  if (layer.kind === 'buildings') {
    parts.push(colorLabel(layer.colorBy))
    if (layer.extrude) parts.push('extruded')
  }
  if (layer.opacityPercent !== 100) parts.push(`${layer.opacityPercent}%`)
  if (!layer.visible) parts.push('hidden')
  return parts.join(' · ')
}

/**
 * The layer whose 3D drawing the zones of selected buildings take the place
 * of (decisions 0034 and 0035): the topmost shown building layer that
 * extrudes.
 */
export function zonesLayer(layers: MapLayer[]): MapLayer | undefined {
  return layers.find(
    (layer) => layer.kind === 'buildings' && layer.visible && layer.extrude,
  )
}
