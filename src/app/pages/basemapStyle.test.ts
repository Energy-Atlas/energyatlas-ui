import type { LayerSpecification, StyleSpecification } from 'maplibre-gl'
import { describe, expect, it } from 'vitest'
import { APPEARANCE_LIST } from '../appearance/appearances.ts'
import {
  BASEMAP_ATTRIBUTION,
  basemapColors,
  basemapRole,
  buildBasemapStyle,
  mixHex,
  QUIET_ROAD_NAMES,
} from './basemapStyle.ts'

// A trimmed stand-in with the layer shapes of OpenFreeMap's Positron style.
const BASE: StyleSpecification = {
  version: 8,
  sources: {
    openmaptiles: {
      type: 'vector',
      url: 'https://tiles.openfreemap.org/planet',
    },
  },
  glyphs: 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf',
  layers: [
    {
      id: 'background',
      type: 'background',
      paint: { 'background-color': 'rgb(242,243,240)' },
    },
    {
      id: 'park',
      type: 'fill',
      source: 'openmaptiles',
      'source-layer': 'park',
      paint: { 'fill-color': 'rgb(230, 233, 229)' },
    },
    {
      id: 'water',
      type: 'fill',
      source: 'openmaptiles',
      'source-layer': 'water',
      paint: { 'fill-color': 'rgb(194, 200, 202)' },
    },
    {
      id: 'landuse_residential',
      type: 'fill',
      source: 'openmaptiles',
      'source-layer': 'landuse',
      paint: { 'fill-color': 'rgb(234, 234, 230)' },
    },
    {
      id: 'building',
      type: 'fill',
      source: 'openmaptiles',
      'source-layer': 'building',
      paint: {
        'fill-color': 'rgb(234, 234, 229)',
        'fill-outline-color': 'rgb(219, 219, 218)',
      },
    },
    {
      id: 'highway_major_casing',
      type: 'line',
      source: 'openmaptiles',
      'source-layer': 'transportation',
      paint: { 'line-color': 'rgb(213, 213, 213)' },
    },
    {
      id: 'highway_motorway_inner',
      type: 'line',
      source: 'openmaptiles',
      'source-layer': 'transportation',
      paint: {
        'line-color': [
          'interpolate',
          ['linear'],
          ['zoom'],
          5.8,
          'hsla(0,0%,85%,0.53)',
          6,
          '#fff',
        ],
      },
    },
    {
      id: 'railway',
      type: 'line',
      source: 'openmaptiles',
      'source-layer': 'transportation',
      paint: { 'line-color': '#dddddd' },
    },
    {
      id: 'road_shield_us',
      type: 'symbol',
      source: 'openmaptiles',
      'source-layer': 'transportation_name',
      layout: { 'icon-image': 'us-shield' },
    },
    {
      id: 'highway-name-minor',
      type: 'symbol',
      source: 'openmaptiles',
      'source-layer': 'transportation_name',
      filter: ['==', ['get', 'class'], 'minor'],
      layout: { 'text-field': '{name}' },
      paint: { 'text-color': '#666' },
    },
    {
      id: 'highway-name-major',
      type: 'symbol',
      source: 'openmaptiles',
      'source-layer': 'transportation_name',
      layout: { 'text-field': '{name}' },
      paint: { 'text-color': '#666', 'text-halo-color': '#fff' },
    },
  ],
}

function layer(style: StyleSpecification, id: string): LayerSpecification {
  const found = style.layers.find((candidate) => candidate.id === id)
  if (!found) throw new Error(`Missing layer ${id}`)
  return found
}

function filterOf(item: LayerSpecification): unknown {
  return (item as { filter?: unknown }).filter
}

function paintOf(item: LayerSpecification): Record<string, unknown> {
  return (item as { paint?: Record<string, unknown> }).paint ?? {}
}

describe('basemap style', () => {
  it('assigns quiet roles and hides competing layers', () => {
    expect(BASE.layers.map((item) => basemapRole(item))).toEqual([
      'background',
      'park',
      'water',
      'land',
      'hidden',
      'casing',
      'road',
      'line',
      'hidden',
      'label',
      'label',
    ])
  })

  it('mixes hex colors', () => {
    expect(mixHex('#000000', '#ffffff', 0)).toBe('#000000')
    expect(mixHex('#000000', '#ffffff', 1)).toBe('#ffffff')
    expect(mixHex('#000000', '#ffffff', 0.5)).toBe('#808080')
  })

  it.each(APPEARANCE_LIST)(
    'recolors every visible layer from $label tokens',
    (appearance) => {
      const style = buildBasemapStyle(BASE, appearance)
      const colors = basemapColors(appearance)

      expect(paintOf(layer(style, 'background'))['background-color']).toBe(
        appearance.chrome.bg,
      )
      expect(paintOf(layer(style, 'water'))['fill-color']).toBe(colors.water)
      expect(colors.water).not.toBe(appearance.chrome.bg)
      expect(
        paintOf(layer(style, 'highway_motorway_inner'))['line-color'],
      ).toBe(colors.road)
      expect(colors.road).not.toBe(appearance.chrome.bg)
      expect(paintOf(layer(style, 'highway-name-major'))).toEqual({
        'text-color': appearance.chrome.textMuted,
        'text-halo-color': appearance.chrome.bg,
      })
      expect(layer(style, 'building').layout).toMatchObject({
        visibility: 'none',
      })
      expect(layer(style, 'road_shield_us').layout).toMatchObject({
        visibility: 'none',
        'icon-image': 'us-shield',
      })

      // No color from the stock style survives on a visible layer.
      for (const item of style.layers) {
        if (item.layout && 'visibility' in item.layout) continue
        for (const [key, value] of Object.entries(paintOf(item))) {
          if (key.endsWith('-color')) expect(value).toMatch(/^#[0-9a-f]{6}$/)
        }
      }
    },
  )

  it('drops alley, path, and track names from street labels', () => {
    const style = buildBasemapStyle(BASE, APPEARANCE_LIST[0]!)
    expect(filterOf(layer(style, 'highway-name-minor'))).toEqual([
      'all',
      ['==', ['get', 'class'], 'minor'],
      QUIET_ROAD_NAMES,
    ])
    expect(filterOf(layer(style, 'highway-name-major'))).toEqual(
      QUIET_ROAD_NAMES,
    )
  })

  it('credits OpenFreeMap, OpenMapTiles, and OpenStreetMap without changing the input', () => {
    const before = structuredClone(BASE)
    const style = buildBasemapStyle(BASE, APPEARANCE_LIST[0]!)
    expect(style.sources.openmaptiles).toMatchObject({
      attribution: BASEMAP_ATTRIBUTION,
    })
    expect(BASEMAP_ATTRIBUTION).toContain('OpenFreeMap')
    expect(BASEMAP_ATTRIBUTION).toContain('OpenMapTiles')
    expect(BASEMAP_ATTRIBUTION).toContain('openstreetmap.org/copyright')
    expect(BASE).toEqual(before)
  })
})
