import { Layer } from '@vis.gl/react-maplibre'
import type { ExpressionSpecification, FilterSpecification } from 'maplibre-gl'
import type { DataPalette } from '../appearance/appearances.ts'

// The selected buildings' zones on the map (decision 0032, stage 6), drawn
// over the "zones" source above the layer stack. Flat, one floor's plan with
// outlines; in 3D, every zone and floor as its own cell between slab gaps.
// With a floor or zone selected (decision 0035), the selected floor is solid
// and the building's other floors are hollow: a faint shell drawn after the
// solid cells and their edges, so the selected floor reads through it.

export const ZONE_SOURCE = 'zones'

export const ZONE_LAYER_IDS = {
  extrusion: 'zones:extrusion',
  hollow: 'zones:hollow',
  fill: 'zones:fill',
  outline: 'zones:outline',
  selected: 'zones:selected',
} as const

export type ZoneDrawing = 'none' | 'plan' | 'extruded'

/** The custom layer drawing zone edges in 3D (ZoneEdgeLayer.tsx, decision 0034). */
export const ZONE_EDGES_LAYER_ID = 'zones:edges'

/** The MapLibre layers a drawing uses, bottom to top. */
export function zoneLayerIds(drawing: ZoneDrawing): string[] {
  if (drawing === 'extruded') {
    // Translucent extrusions write depth before colour, so the hollow shell
    // comes last: the solid floor and its edges are already drawn under it.
    return [
      ZONE_LAYER_IDS.extrusion,
      ZONE_EDGES_LAYER_ID,
      ZONE_LAYER_IDS.hollow,
    ]
  }
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
    const isHollow = [
      '==',
      ['get', 'state'],
      'hollow',
    ] as unknown as FilterSpecification
    return (
      // Keyed: react-maplibre keeps the id and type a layer mounted with, so
      // switching from the plan to the extrusion must mount a new layer.
      <>
        <Layer
          key={ZONE_LAYER_IDS.extrusion}
          id={ZONE_LAYER_IDS.extrusion}
          type="fill-extrusion"
          source={ZONE_SOURCE}
          filter={['!', isHollow] as unknown as FilterSpecification}
          paint={{
            'fill-extrusion-color': [
              'match',
              ['get', 'state'],
              'selected',
              palette.selection,
              'muted',
              palette.hollow.muted,
              color,
            ] as unknown as ExpressionSpecification,
            'fill-extrusion-base': ['get', 'base'],
            'fill-extrusion-height': ['get', 'top'],
            'fill-extrusion-opacity': 0.95,
          }}
        />
        <Layer
          key={ZONE_LAYER_IDS.hollow}
          id={ZONE_LAYER_IDS.hollow}
          type="fill-extrusion"
          source={ZONE_SOURCE}
          filter={isHollow}
          paint={{
            'fill-extrusion-color': palette.deemphasis,
            'fill-extrusion-base': ['get', 'base'],
            'fill-extrusion-height': ['get', 'top'],
            'fill-extrusion-opacity': palette.hollow.opacity,
          }}
        />
      </>
    )
  }
  if (drawing === 'none') return null
  const onFloor = ['==', ['get', 'floor'], planFloor] as FilterSpecification
  return (
    <>
      <Layer
        key={ZONE_LAYER_IDS.fill}
        id={ZONE_LAYER_IDS.fill}
        type="fill"
        source={ZONE_SOURCE}
        filter={onFloor}
        paint={{ 'fill-color': color, 'fill-opacity': 0.9 }}
      />
      <Layer
        key={ZONE_LAYER_IDS.outline}
        id={ZONE_LAYER_IDS.outline}
        type="line"
        source={ZONE_SOURCE}
        filter={onFloor}
        layout={{ 'line-join': 'round' }}
        paint={{ 'line-color': palette.ink.surface, 'line-width': 1.5 }}
      />
      <Layer
        key={ZONE_LAYER_IDS.selected}
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
