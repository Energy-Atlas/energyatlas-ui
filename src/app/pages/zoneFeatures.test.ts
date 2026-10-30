import { describe, expect, it } from 'vitest'
import type { LngLat, WorkbenchState } from '../../domain/types.ts'
import { createWorkbench } from '../../domain/workbench.ts'
import { STAGE_IDS } from '../../domain/workflow.ts'
import { buildFixture } from '../../server/fixtures.ts'
import { createViewStore } from '../view/viewStore.ts'
import {
  MAX_ZONED_BUILDINGS,
  zoneEdges,
  zoneOverlay,
  type EdgeRole,
  type EdgeStyle,
  type ZoneEdges,
} from './zoneFeatures.ts'
import {
  colorOf,
  edgeVertices,
  parseColor,
  pullShare,
  releaseGl,
  translated,
} from './ZoneEdgeLayer.tsx'
import {
  defaultLayers,
  layerSummary,
  layersDiffer,
  parseStoredLayers,
  zonesLayer,
} from './mapLayers.ts'

// Zones on the map (decision 0032, stage 6; decisions 0035 and 0036): the
// backend's zone geometry, hollow floors, and edges drawn once each.

const NOW = () => new Date('2026-10-28T12:00:00Z')
const complete = buildFixture('complete', NOW)

const withSelection = (
  entityType: WorkbenchState['selection']['entityType'],
  ids: string[],
): WorkbenchState => ({ ...complete, selection: { entityType, ids } })

const footprints = (state: WorkbenchState) =>
  Object.fromEntries(
    state.buildingIds.map((id) => [id, state.buildings[id]?.footprint]),
  ) as Record<string, LngLat[]>

function edgesOf(state: WorkbenchState): ZoneEdges[] {
  return zoneEdges(zoneOverlay(state).cells.features, footprints(state))
}

/** How many segments a building's edges have, by role and optionally style. */
function count(
  group: ZoneEdges | undefined,
  role: EdgeRole,
  style?: EdgeStyle,
  vertical?: boolean,
): number {
  let total = 0
  for (const part of group?.parts ?? []) {
    if (part.role !== role || (style && part.style !== style)) continue
    for (let at = 0; at < part.segments.length; at += 6) {
      const upright =
        part.segments[at] === part.segments[at + 3] &&
        part.segments[at + 1] === part.segments[at + 4]
      if (vertical === undefined || vertical === upright) total += 1
    }
  }
  return total
}

/** Every segment as an undirected key, to find any drawn twice. */
function segmentKeys(group: ZoneEdges | undefined): string[] {
  return (group?.parts ?? []).flatMap((part) => {
    const keys: string[] = []
    for (let at = 0; at < part.segments.length; at += 6) {
      const a = part.segments.slice(at, at + 3).join(',')
      const b = part.segments.slice(at + 3, at + 6).join(',')
      keys.push([a, b].sort().join('|'))
    }
    return keys
  })
}

describe('zone cells', () => {
  it('draws the zones of selected buildings only, each storey spanning its floor exactly', () => {
    expect(zoneOverlay(complete).cells.features).toEqual([])
    const overlay = zoneOverlay(
      withSelection('building', ['B0439', 'B0427', 'B0426']),
    )
    const cells = (id: string) =>
      overlay.cells.features.filter((cell) => cell.properties.buildingId === id)
    expect(cells('B0439')).toHaveLength(25)
    expect(cells('B0427')).toHaveLength(9)
    expect(cells('B0426')).toHaveLength(15)
    expect(overlay.geometry).toBe(true)
    expect(overlay.legend.map((row) => row.kind)).toEqual([
      'drawn',
      'floor',
      'core',
      'perimeter',
    ])
    // No slab gap: a storey's top is the next one's base, and the top storey
    // ends at the building's height, as its extrusion does.
    const floor3 = cells('B0427').find((cell) => cell.properties.floor === 3)
    const floor4 = cells('B0427').find((cell) => cell.properties.floor === 4)
    expect(floor3?.properties.top).toBe(floor4?.properties.base)
    expect(Math.max(...cells('B0427').map((cell) => cell.properties.top))).toBe(
      complete.buildings.B0427?.heightM,
    )
    expect(
      new Set(overlay.cells.features.map((cell) => cell.properties.state)),
    ).toEqual(new Set(['zone']))
  })

  it('keeps the colours of a selected zone and its neighbours, and draws the other floors hollow (M2)', () => {
    const overlay = zoneOverlay(withSelection('zone', ['B0439:F2:Z2']))
    expect(overlay.planFloor).toBe(2)
    expect(overlay.focus).toEqual({
      buildingId: 'B0439',
      floors: [2],
      level: 'zone',
    })
    const stateOf = (floor: number, id?: string) =>
      new Set(
        overlay.cells.features
          .filter(
            (cell) =>
              cell.properties.floor === floor &&
              (id === undefined || cell.properties.id === id),
          )
          .map((cell) => cell.properties.state),
      )
    expect(stateOf(2, 'B0439:F2:Z2')).toEqual(new Set(['selected']))
    // The floor's other zones are drawn as the selected floor's, in their
    // own colours: nothing is muted.
    expect(stateOf(2, 'B0439:F2:Z3')).toEqual(new Set(['floor']))
    expect(stateOf(1)).toEqual(new Set(['hollow']))
    expect(stateOf(4)).toEqual(new Set(['hollow']))
    expect(overlay.hollow).toBe(true)
    // Their colour slots are the zones' own.
    const slots = overlay.cells.features
      .filter((cell) => cell.properties.floor === 2)
      .map((cell) => cell.properties.colorSlot)
    expect(new Set(slots).size).toBeGreaterThan(2)
  })

  it('highlights a selected whole-building zone on every storey, with nothing hollow', () => {
    const single = zoneOverlay(withSelection('zone', ['B0464:Z1']))
    expect(single.hollow).toBe(false)
    const storeys = single.cells.features
    expect(storeys.length).toBe(complete.buildings.B0464?.floors)
    expect(new Set(storeys.map((cell) => cell.properties.state))).toEqual(
      new Set(['selected']),
    )
    expect(single.focus).toEqual({
      buildingId: 'B0464',
      floors: storeys.map((cell) => cell.properties.floor),
      level: 'building zone',
    })
    expect(single.geometry).toBe(false)
  })

  it('bounds the geometry to the first selected buildings', () => {
    const ids = complete.buildingIds.slice(0, 30)
    const overlay = zoneOverlay(withSelection('building', ids))
    expect(overlay.buildingIds).toHaveLength(MAX_ZONED_BUILDINGS)
    expect(overlay.omitted).toBe(30 - MAX_ZONED_BUILDINGS)
  })
})

describe('zone edges in 3D (decision 0036)', () => {
  it('draws each floor of a zone-per-floor building once: envelope outline and corners, a boundary line at every floor', () => {
    const [group] = edgesOf(withSelection('building', ['B0427']))
    const storeys = complete.buildings.B0427?.floors ?? 0
    // The outline at the ground and roof, and one upright per corner and storey.
    expect(count(group, 'envelope', undefined, false)).toBe(4 * 2)
    expect(count(group, 'envelope', undefined, true)).toBe(4 * storeys)
    // Each floor between two zones is one line around the facade, not two
    // a slab gap apart.
    expect(count(group, 'boundary', undefined, false)).toBe(4 * (storeys - 1))
    expect(count(group, 'boundary', undefined, true)).toBe(0)
    const keys = segmentKeys(group)
    expect(new Set(keys).size).toBe(keys.length)
  })

  it('draws a one-zone building as its envelope alone', () => {
    const [group] = edgesOf(withSelection('building', ['B0464']))
    expect(count(group, 'boundary')).toBe(0)
    expect(count(group, 'envelope', undefined, false)).toBeGreaterThan(0)
  })

  it('draws every wall shared by two zones once, splitting walls at every corner on them', () => {
    const [group] = edgesOf(withSelection('building', ['B0439']))
    const keys = segmentKeys(group)
    expect(new Set(keys).size).toBe(keys.length)
    // Uprights on the envelope only at the footprint's four corners.
    expect(count(group, 'envelope', undefined, true)).toBe(4 * 4)
    // Interior walls: uprights where zones meet, and lines on every floor.
    expect(count(group, 'boundary', undefined, true)).toBeGreaterThan(0)
    expect(count(group, 'boundary', undefined, false)).toBeGreaterThan(
      count(group, 'envelope', undefined, false),
    )
    // No segment overlaps another on the same line: a wall split
    // differently by the plans above and below is drawn in pieces once.
    const horizontal = (group?.parts ?? []).flatMap((part) => {
      const out: number[][] = []
      for (let at = 0; at < part.segments.length; at += 6) {
        const s = part.segments.slice(at, at + 6)
        if (s[0] !== s[3] || s[1] !== s[4]) out.push(s)
      }
      return out
    })
    for (const [index, a] of horizontal.entries()) {
      for (const b of horizontal.slice(index + 1)) {
        if (a[2] !== b[2]) continue
        // Overlap: both of b's ends strictly inside a, or the same segment.
        const inside = (p: number[]) => {
          const [ax = 0, ay = 0, , bx = 0, by = 0] = a
          const cross = (bx - ax) * (p[1]! - ay) - (by - ay) * (p[0]! - ax)
          const dot = (p[0]! - ax) * (bx - ax) + (p[1]! - ay) * (by - ay)
          const length2 = (bx - ax) ** 2 + (by - ay) ** 2
          return Math.abs(cross) < 1e-14 && dot > 1e-16 && dot < length2 - 1e-16
        }
        expect(inside([b[0]!, b[1]!]) && inside([b[3]!, b[4]!])).toBe(false)
      }
    }
  })

  it('draws a selected zone in the selection style and its floor emphasised', () => {
    const [group] = edgesOf(withSelection('zone', ['B0439:F2:Z2']))
    // The corridor's outline at its base and top, and its uprights.
    expect(count(group, 'boundary', 'selected')).toBeGreaterThan(0)
    expect(count(group, 'boundary', 'focus')).toBeGreaterThan(0)
    expect(count(group, 'envelope', 'hollow')).toBeGreaterThan(0)
    expect(count(group, 'boundary', 'zone')).toBe(0)
    const [first] = group?.parts ?? []
    expect(first?.style).toBe('hollow')
    expect(group?.parts.at(-1)?.style).toBe('selected')
  })

  it('colours edges by role from the tokens, faint on hollow floors', () => {
    const colors = {
      roles: {
        envelope: parseColor('#18202c'),
        boundary: parseColor('#ffffff'),
      },
      selected: parseColor('#125dae'),
      hollowAlpha: 0.5,
    }
    expect(colorOf(colors, 'zone', 'boundary')).toEqual([1, 1, 1, 1])
    expect(colorOf(colors, 'hollow', 'envelope')[3]).toBe(0.5)
    expect(colorOf(colors, 'selected', 'envelope')).toEqual(colors.selected)
  })

  it('pulls edges towards the camera by about a pixel and a half, at any distance', () => {
    // A 36.87° field of view over 800 px: 1.5 px is 0.00125 of the distance.
    expect(pullShare(36.87, 800)).toBeCloseTo(0.00125, 5)
    expect(pullShare(36.87, 400)).toBeCloseTo(0.0025, 5)
    expect(pullShare(36.87, 0.001)).toBe(0.5)
  })

  it('sends six vertices per segment and offsets the matrix in double precision', () => {
    const [group] = edgesOf(withSelection('building', ['B0427']))
    const part = group?.parts[0]
    const origin = [0.3, 0.37, 0] as [number, number, number]
    expect(edgeVertices(part?.segments ?? [], origin)).toHaveLength(
      ((part?.segments.length ?? 0) / 6) * 6 * 7,
    )
    const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]
    expect([...translated(identity, [2, 3, 4])]).toEqual([
      1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 2, 3, 4, 1,
    ])
    expect(parseColor('#ff8000')).toEqual([1, 128 / 255, 0, 1])
    expect(parseColor('rgb(0, 255, 0)')).toEqual([0, 1, 0, 1])
  })

  it('releases the edge layer only through the context that made it', () => {
    const deleted: string[] = []
    const gl = {
      deleteProgram: () => deleted.push('program'),
      deleteVertexArray: () => deleted.push('vertexArray'),
      deleteBuffer: () => deleted.push('buffer'),
    } as unknown as WebGL2RenderingContext
    const other = {} as WebGL2RenderingContext
    const state = {
      gl,
      program: {},
      vertexArray: {},
      buffers: new Map([[new Float32Array(1), {}]]),
      meshes: [],
    } as unknown as Parameters<typeof releaseGl>[0]
    releaseGl(state, other)
    expect(deleted).toEqual([])
    releaseGl(state, gl)
    expect(deleted).toEqual(['program', 'vertexArray', 'buffer'])
    expect(state.buffers.size).toBe(0)
  })
})

describe('layer settings and view operations', () => {
  it('opens a layer stack saved with the removed floor slab and explode settings', () => {
    const saved = defaultLayers().map((layer) => ({
      ...layer,
      floorSlabs: false,
      explodeFloors: layer.kind === 'buildings',
    }))
    const read = parseStoredLayers(saved)
    expect(read).toEqual(defaultLayers())
    expect(read.some((layer) => 'floorSlabs' in layer)).toBe(false)
    // So the reopened project shows no unsaved change to its stack.
    expect(layersDiffer(defaultLayers(), saved)).toBe(false)
    expect(layerSummary(read.find((layer) => layer.id === 'buildings')!)).toBe(
      'Floors · extruded · 90%',
    )
    // The view operation no longer takes either.
    const workbench = createWorkbench({ initialState: complete, now: NOW })
    const view = createViewStore(workbench)
    expect(
      view.execute({
        type: 'map.setLayerStyle',
        input: {
          layerId: 'buildings',
          floorSlabs: true,
        } as unknown as { layerId: string },
      }).outcome,
    ).toMatchObject({
      status: 'rejected',
      issues: [{ message: 'Nothing to change.' }],
    })
    expect(zonesLayer(view.getState().map.layers)?.id).toBe('buildings')
  })

  it('shows floors and zones in the Table and zooms to a selected zone', () => {
    const workbench = createWorkbench({ initialState: complete, now: NOW })
    const view = createViewStore(workbench)
    expect(
      view.execute({ type: 'table.setView', input: { view: 'zones' } }).outcome,
    ).toEqual({
      status: 'applied',
      summary: 'The table shows the zones of every building.',
    })
    workbench.execute({
      type: 'selection.set',
      input: { entityType: 'zone', ids: ['B0439:F1:Z1'] },
    })
    expect(
      view.execute({ type: 'map.focusSelection', input: {} }).outcome,
    ).toEqual({
      status: 'applied',
      summary: 'Zoomed the map to 1 selected zone(s).',
    })
    workbench.execute({
      type: 'selection.set',
      input: { entityType: 'stage', ids: [STAGE_IDS.preprocessing] },
    })
    expect(
      view.execute({ type: 'map.focusSelection', input: {} }).outcome.status,
    ).toBe('rejected')
  })

  it('says how many of a large selection get zones in 3D', () => {
    const workbench = createWorkbench({ initialState: complete, now: NOW })
    const view = createViewStore(workbench)
    const ids = complete.buildingIds.slice(0, MAX_ZONED_BUILDINGS + 5)
    workbench.execute({
      type: 'selection.set',
      input: { entityType: 'building', ids },
    })
    view.execute({ type: 'map.set3d', input: { enabled: true } })
    expect(
      view.execute({ type: 'map.focusSelection', input: {} }).outcome,
    ).toMatchObject({
      summary: `Zoomed the map to ${ids.length} selected building(s). Zones are drawn for the first ${MAX_ZONED_BUILDINGS} of ${ids.length} buildings.`,
    })
  })
})
