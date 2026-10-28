import { Layer } from '@vis.gl/react-maplibre'
import type { ExpressionSpecification, FilterSpecification } from 'maplibre-gl'
import type { DataPalette } from '../appearance/appearances.ts'
import type { MapLayer } from './mapLayers.ts'
import {
  METRICS,
  type MetricDefinition,
  type MetricId,
  type MetricValues,
} from './mapMetrics.ts'

// Draws one layer of the map's stack (decision 0031) over the shared sources
// "buildings", "grid-lines", and "grid-points". Several stack layers may draw
// the same source; selection is feature state on the source, so every layer
// of a source shows it.

/** A stack layer with what it draws resolved against the project's data. */
export type ResolvedLayer = {
  layer: MapLayer
  /** The metric a building layer colors by, after any fallback. */
  metric: MetricDefinition | null
  values: MetricValues | null
  /** Whether a building layer stands at its heights now (3D view on). */
  extruded: boolean
  /** Whether an extruded building layer is drawn as floor slabs (decision 0032, stage 6). */
  slabs: boolean
  /** Every MapLibre layer id it draws, bottom to top. */
  mapIds: string[]
  /** The MapLibre layer that picks its features. */
  pickId: string
}

export function resolveLayers(
  layers: MapLayer[],
  metrics: Record<MetricId, MetricValues>,
  view3d: boolean,
): ResolvedLayer[] {
  return layers.map((layer) => {
    const prefix = `stack:${layer.id}`
    if (layer.kind === 'gridLines') {
      const id = `${prefix}:line`
      return {
        layer,
        metric: null,
        values: null,
        extruded: false,
        slabs: false,
        mapIds: [id],
        pickId: id,
      }
    }
    if (layer.kind === 'gridPoints') {
      const id = `${prefix}:circle`
      return {
        layer,
        metric: null,
        values: null,
        extruded: false,
        slabs: false,
        mapIds: [id],
        pickId: id,
      }
    }
    // Fall back to the first metric with data instead of an empty ramp.
    const wanted = layer.colorBy === 'single' ? null : layer.colorBy
    const metricId =
      wanted === null
        ? null
        : metrics[wanted].available
          ? wanted
          : (METRICS.find((metric) => metrics[metric.id].available)?.id ??
            wanted)
    const metric = METRICS.find((each) => each.id === metricId) ?? null
    const extruded = view3d && layer.extrude
    const mapIds = extruded
      ? [`${prefix}:extrusion`]
      : [`${prefix}:fill`, `${prefix}:halo`, `${prefix}:selected`]
    return {
      layer,
      metric,
      values: metricId ? metrics[metricId] : null,
      extruded,
      slabs: extruded && layer.floorSlabs,
      mapIds,
      pickId: mapIds[0] ?? prefix,
    }
  })
}

/** The building feature property that holds a metric's value. */
export function metricProperty(metric: MetricId): string {
  return `metric:${metric}`
}

function fillColor(
  resolved: ResolvedLayer,
  palette: DataPalette,
): ExpressionSpecification | string {
  const { metric, values } = resolved
  if (!metric || !values) return palette.categorical[0]
  const ramp = palette.sequential
  const span = values.max - values.min || 1
  const stops = ramp.flatMap((color, index) => [
    values.min + (span * index) / (ramp.length - 1),
    color,
  ])
  const value = ['get', metricProperty(metric.id)]
  return [
    'case',
    ['<', value, 0],
    palette.noData,
    ['interpolate', ['linear'], value, ...stops],
  ] as unknown as ExpressionSpecification
}

const selected = [
  'case',
  ['boolean', ['feature-state', 'selected'], false],
] as const

function whenSelected<T>(yes: T, no: T): ExpressionSpecification {
  return [...selected, yes, no] as unknown as ExpressionSpecification
}

/** Leaves out buildings whose zones are drawn in their place. */
function without(ids: string[]): FilterSpecification | undefined {
  if (ids.length === 0) return undefined
  return [
    '!',
    ['in', ['get', 'id'], ['literal', ids]],
  ] as unknown as FilterSpecification
}

export function StackLayer({
  resolved,
  palette,
  zonedIds = [],
}: {
  resolved: ResolvedLayer
  palette: DataPalette
  /** Buildings drawn as zones instead, in 3D. */
  zonedIds?: string[]
}) {
  const { layer, mapIds, extruded } = resolved
  const visibility = layer.visible ? 'visible' : 'none'
  const opacity = layer.opacityPercent / 100
  const ink = palette.ink

  if (layer.kind === 'gridLines') {
    return (
      <Layer
        key={mapIds[0]}
        id={mapIds[0]}
        type="line"
        source="grid-lines"
        layout={{ visibility, 'line-cap': 'round', 'line-join': 'round' }}
        paint={{
          'line-color': whenSelected(palette.selection, palette.networkLine),
          'line-width': 2.5,
          'line-opacity': opacity,
        }}
      />
    )
  }
  if (layer.kind === 'gridPoints') {
    return (
      <Layer
        key={mapIds[0]}
        id={mapIds[0]}
        type="circle"
        source="grid-points"
        layout={{ visibility }}
        paint={{
          'circle-color': palette.networkPoint,
          'circle-radius': whenSelected(8, 5),
          'circle-stroke-width': 2,
          'circle-stroke-color': whenSelected(palette.selection, ink.surface),
          'circle-opacity': opacity,
          'circle-stroke-opacity': opacity,
        }}
      />
    )
  }
  const color = fillColor(resolved, palette)
  if (extruded) {
    // Selection never changes a building's color; in 3D it is outlined by
    // SelectionSilhouette. Slabs stack one per floor (decision 0032, stage 6).
    // The source changes with slabs, so the layer is keyed by it.
    const filter = without(zonedIds)
    return resolved.slabs ? (
      <Layer
        key={`${mapIds[0]}:slabs`}
        id={mapIds[0]}
        type="fill-extrusion"
        source="floor-slabs"
        layout={{ visibility }}
        {...(filter ? { filter } : {})}
        paint={{
          'fill-extrusion-color': color,
          'fill-extrusion-base': ['get', 'base'],
          'fill-extrusion-height': ['get', 'top'],
          'fill-extrusion-opacity': opacity,
        }}
      />
    ) : (
      <Layer
        key={mapIds[0]}
        id={mapIds[0]}
        type="fill-extrusion"
        source="buildings"
        layout={{ visibility }}
        {...(filter ? { filter } : {})}
        paint={{
          'fill-extrusion-color': color,
          'fill-extrusion-height': ['get', 'height'],
          'fill-extrusion-opacity': opacity,
        }}
      />
    )
  }
  return (
    <>
      <Layer
        key={mapIds[0]}
        id={mapIds[0]}
        type="fill"
        source="buildings"
        layout={{ visibility }}
        paint={{
          'fill-color': color,
          'fill-opacity': opacity,
          'fill-outline-color': ink.surface,
        }}
      />
      {/* A surface-colored halo keeps the selection outline visible on any
          fill. Feature state drives opacity, not width. */}
      <Layer
        key={mapIds[1]}
        id={mapIds[1]}
        type="line"
        source="buildings"
        layout={{ visibility }}
        paint={{
          'line-color': ink.surface,
          'line-width': 6,
          'line-opacity': whenSelected(1, 0),
        }}
      />
      <Layer
        key={mapIds[2]}
        id={mapIds[2]}
        type="line"
        source="buildings"
        layout={{ visibility }}
        paint={{
          'line-color': palette.selection,
          'line-width': 2.5,
          'line-opacity': whenSelected(1, 0),
        }}
      />
    </>
  )
}
