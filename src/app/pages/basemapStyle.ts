import type {
  FilterSpecification,
  LayerSpecification,
  StyleSpecification,
} from 'maplibre-gl'
import type { Appearance } from '../appearance/appearances.ts'

// OpenFreeMap basemap (decision 0012). The public style is fetched once and its
// paint colors are rewritten from the active appearance, so streets, water, and
// labels stay quiet context in every appearance (guidelines section 6). The
// basemap's own buildings are hidden so only modeled footprints are drawn.

export const BASEMAP_STYLE_URL = 'https://tiles.openfreemap.org/styles/positron'

/** The OpenMapTiles vector source in OpenFreeMap styles. */
export const BASEMAP_SOURCE_ID = 'openmaptiles'

function link(href: string, text: string): string {
  return `<a href="${href}" target="_blank" rel="noreferrer">${text}</a>`
}

export const BASEMAP_ATTRIBUTION = `${link('https://openfreemap.org', 'OpenFreeMap')} ${link('https://www.openmaptiles.org/', '&copy; OpenMapTiles')} Data from ${link('https://www.openstreetmap.org/copyright', 'OpenStreetMap')}`

/** Credit for the bundled footprint extract, shown with or without the basemap. */
export const FOOTPRINT_ATTRIBUTION = link(
  'https://www.openstreetmap.org/copyright',
  '&copy; OpenStreetMap contributors',
)

/**
 * Alley, footpath, and track names crowd the blocks at district zoom and
 * compete with the modeled buildings, so street labels keep only named roads.
 */
export const QUIET_ROAD_NAMES: FilterSpecification = [
  '!',
  ['in', ['get', 'class'], ['literal', ['service', 'path', 'track']]],
]

export type BasemapRole =
  | 'hidden'
  | 'background'
  | 'water'
  | 'park'
  | 'land'
  | 'road'
  | 'casing'
  | 'line'
  | 'label'

export function basemapRole(layer: LayerSpecification): BasemapRole {
  const sourceLayer =
    'source-layer' in layer ? layer['source-layer'] : undefined
  if (layer.type === 'background') return 'background'
  if (sourceLayer === 'building' || layer.id.includes('shield')) return 'hidden'
  if (layer.type === 'symbol') return 'label'
  if (sourceLayer === 'water' || sourceLayer === 'waterway') return 'water'
  if (layer.type === 'fill') {
    if (sourceLayer === 'park' || layer.id.includes('wood')) return 'park'
    return sourceLayer === 'transportation' || sourceLayer === 'aeroway'
      ? 'road'
      : 'land'
  }
  if (layer.type === 'line') {
    if (layer.id.includes('dashline')) return 'road'
    if (sourceLayer === 'boundary' || layer.id.includes('rail')) return 'line'
    if (layer.id.includes('casing') || layer.id.includes('subtle')) {
      return 'casing'
    }
    return 'road'
  }
  // Raster relief, 3D extrusions, circles, and heatmaps compete with the
  // modeled objects.
  return 'hidden'
}

function channels(hex: string): [number, number, number] {
  const value = hex.replace('#', '')
  return [0, 2, 4].map((start) =>
    Number.parseInt(value.slice(start, start + 2), 16),
  ) as [number, number, number]
}

/** Mixes two #rrggbb colors; weight 0 returns `from`, 1 returns `to`. */
export function mixHex(from: string, to: string, weight: number): string {
  const a = channels(from)
  const b = channels(to)
  return `#${a
    .map((channel, index) =>
      Math.round(channel + ((b[index] ?? channel) - channel) * weight)
        .toString(16)
        .padStart(2, '0'),
    )
    .join('')}`
}

export type BasemapColors = Record<
  Exclude<BasemapRole, 'hidden'> | 'halo',
  string
>

export function basemapColors(appearance: Appearance): BasemapColors {
  const { chrome, data } = appearance
  return {
    background: chrome.bg,
    water: mixHex(chrome.bg, data.sequential[1] ?? chrome.border, 0.35),
    park: chrome.surfaceRaised,
    land: mixHex(chrome.bg, chrome.surfaceRaised, 0.5),
    // Panes and gutters share one colour in the family appearances; roads
    // then take the raised surface so they stay apart from the land.
    road: chrome.surface === chrome.bg ? chrome.surfaceRaised : chrome.surface,
    casing: chrome.borderSubtle,
    line: chrome.border,
    label: chrome.textMuted,
    halo: chrome.bg,
  }
}

/** Returns a copy of an OpenFreeMap style recolored for the appearance. */
export function buildBasemapStyle(
  base: StyleSpecification,
  appearance: Appearance,
): StyleSpecification {
  const style = structuredClone(base)
  const colors = basemapColors(appearance)
  const source = style.sources[BASEMAP_SOURCE_ID]
  if (source?.type === 'vector') source.attribution = BASEMAP_ATTRIBUTION

  style.layers = style.layers.map((layer) => {
    const role = basemapRole(layer)
    if (role === 'hidden') {
      return {
        ...layer,
        layout: { ...layer.layout, visibility: 'none' },
      }
    }
    const paint: Record<string, unknown> = {
      ...((layer as { paint?: Record<string, unknown> }).paint ?? {}),
    }
    if (role === 'background') paint['background-color'] = colors.background
    for (const key of Object.keys(paint)) {
      if (!key.endsWith('-color')) continue
      paint[key] =
        role === 'label'
          ? key.includes('halo')
            ? colors.halo
            : colors.label
          : colors[role]
    }
    if (
      role === 'label' &&
      'source-layer' in layer &&
      layer['source-layer'] === 'transportation_name'
    ) {
      return {
        ...layer,
        paint,
        filter: layer.filter
          ? ['all', layer.filter, QUIET_ROAD_NAMES]
          : QUIET_ROAD_NAMES,
      } as LayerSpecification
    }
    return { ...layer, paint }
  })
  return style
}
