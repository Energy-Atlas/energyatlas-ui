import { Layer } from '@vis.gl/react-maplibre'
import type { ExpressionSpecification, FilterSpecification } from 'maplibre-gl'
import type { DataPalette } from '../appearance/appearances.ts'

// The selected buildings' zones on the map (decision 0032, stage 6), drawn
// over the "zones" source above the layer stack. Flat, one floor's plan with
// outlines; in 3D, every zone and floor as its own cell between slab gaps.

export const ZONE_SOURCE = 'zones'

export const ZONE_LAYER_IDS = {
  extrusion: 'zones:extrusion',
  fill: 'zones:fill',
  outline: 'zones:outline',
  selected: 'zones:selected',
} as const

export type ZoneDrawing = 'none' | 'plan' | 'extruded'

/** The MapLibre layers a drawing uses, bottom to top. */
export function zoneLayerIds(drawing: ZoneDrawing): string[] {
  if (drawing === 'extruded') return [ZONE_LAYER_IDS.extrusion]
  if (drawing === 'plan') {
    return [
      ZONE_LAYER_IDS.fill,
      ZONE_LAYER_IDS.outline,
      ZONE_LAYER_IDS.selected,
    ]
  }
  return []
}

/** A zone's colour: neighbours take different categorical slots; the core is de-emphasised. */
export function zoneColor(palette: DataPalette): ExpressionSpecification {
  const [first, second, third] = palette.categorical
  return [
    'match',
    ['get', 'colorSlot'],
    0,
    first,
    1,
    second,
    2,
    third,
    palette.deemphasis,
  ] as unknown as ExpressionSpecification
}

export function ZoneLayers({
  drawing,
  planFloor,
  palette,
}: {
  drawing: ZoneDrawing
  planFloor: number
  palette: DataPalette
}) {
  const color = zoneColor(palette)
  if (drawing === 'extruded') {
    return (
      <Layer
        id={ZONE_LAYER_IDS.extrusion}
        type="fill-extrusion"
        source={ZONE_SOURCE}
        paint={{
          'fill-extrusion-color': [
            'case',
            ['boolean', ['get', 'selected'], false],
            palette.selection,
            color,
          ] as unknown as ExpressionSpecification,
          'fill-extrusion-base': ['get', 'base'],
          'fill-extrusion-height': ['get', 'top'],
          'fill-extrusion-opacity': 0.95,
        }}
      />
    )
  }
  if (drawing === 'none') return null
  const onFloor = ['==', ['get', 'floor'], planFloor] as FilterSpecification
  return (
    <>
      <Layer
        id={ZONE_LAYER_IDS.fill}
        type="fill"
        source={ZONE_SOURCE}
        filter={onFloor}
        paint={{ 'fill-color': color, 'fill-opacity': 0.9 }}
      />
      <Layer
        id={ZONE_LAYER_IDS.outline}
        type="line"
        source={ZONE_SOURCE}
        filter={onFloor}
        layout={{ 'line-join': 'round' }}
        paint={{ 'line-color': palette.ink.surface, 'line-width': 1.5 }}
      />
      <Layer
        id={ZONE_LAYER_IDS.selected}
        type="line"
        source={ZONE_SOURCE}
        filter={
          [
            'all',
            onFloor,
            ['boolean', ['get', 'selected'], false],
          ] as FilterSpecification
        }
        layout={{ 'line-join': 'round' }}
        paint={{ 'line-color': palette.selection, 'line-width': 3 }}
      />
    </>
  )
}
