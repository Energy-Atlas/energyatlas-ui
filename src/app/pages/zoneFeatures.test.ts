import { describe, expect, it } from 'vitest'
import { runStageNow } from '../../domain/jobs/runNow.ts'
import { createWorkbench } from '../../domain/workbench.ts'
import { STAGE_IDS } from '../../domain/workflow.ts'
import { buildFixture } from '../../server/fixtures.ts'
import { createViewStore } from '../view/viewStore.ts'
import { METRICS, computeMetric, type MetricId } from './mapMetrics.ts'
import {
  MAX_ZONED_BUILDINGS,
  slabFeatures,
  storeySpan,
  zoneEdges,
  zoneOverlay,
} from './zoneFeatures.ts'
import {
  edgeVertices,
  parseColor,
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
import { showZonesIn3d, zones3dBlocker } from './showZones3d.ts'

// Floors and zones on the map (decision 0032, stage 6).

const NOW = () => new Date('2026-10-28T12:00:00Z')

function zoned() {
  const workbench = createWorkbench({
    initialState: buildFixture('partway', NOW),
    now: NOW,
  })
  workbench.execute({
    type: 'zoning.set',
    input: { mode: 'perimeterCore', perimeterDepthM: 4.5 },
  })
  runStageNow(workbench, STAGE_IDS.preprocessing)
  return workbench
}

describe('floor slabs and zone cells', () => {
  it('draws one slab per floor of every building with a height, apart by a gap', () => {
    const state = buildFixture('partway', NOW)
    const metrics = Object.fromEntries(
      METRICS.map((metric) => [metric.id, computeMetric(state, metric.id)]),
    ) as Record<MetricId, ReturnType<typeof computeMetric>>
    const slabs = slabFeatures(state, metrics)
    const floors = state.buildingIds.reduce(
      (sum, id) => sum + (state.buildings[id]?.floors ?? 0),
      0,
    )
    expect(slabs.features).toHaveLength(floors)
    const first = slabs.features.find(
      (feature) => feature.properties.floorId === 'B0039:F2',
    )
    expect(first?.properties.id).toBe('B0039')
    expect(first?.properties.base).toBeCloseTo(3.2)
    expect(first?.properties.top).toBeLessThan(6.4)
    expect(first?.properties.top).toBeGreaterThan(6)
  })

  it('draws the zones of selected buildings only, and a selected floor or zone solid among hollow floors', () => {
    const workbench = zoned()
    expect(zoneOverlay(workbench.getState()).cells.features).toEqual([])
    workbench.execute({
      type: 'selection.set',
      input: { entityType: 'building', ids: ['B0039'] },
    })
    let overlay = zoneOverlay(workbench.getState())
    expect(overlay.buildingIds).toEqual(['B0039'])
    expect(overlay.kinds.sort()).toEqual(['core', 'perimeter'])
    expect(overlay.focus).toBeNull()
    expect(overlay.hollow).toBe(false)
    // A selected building shows every zone in its colour.
    expect(
      new Set(overlay.cells.features.map((cell) => cell.properties.state)),
    ).toEqual(new Set(['zone']))
    const floors = workbench.getState().buildings.B0039?.floors ?? 0
    expect(
      new Set(overlay.cells.features.map((cell) => cell.properties.floor)).size,
    ).toBe(floors)

    workbench.execute({
      type: 'selection.set',
      input: { entityType: 'zone', ids: ['B0039:F2:Z1'] },
    })
    overlay = zoneOverlay(workbench.getState())
    expect(overlay.planFloor).toBe(2)
    expect(overlay.focus).toEqual({
      buildingId: 'B0039',
      floors: [2],
      level: 'zone',
    })
    // No floor is cut away or moved: every storey keeps its cells.
    expect(
      new Set(overlay.cells.features.map((cell) => cell.properties.floor)).size,
    ).toBe(floors)
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
    expect(stateOf(2, 'B0039:F2:Z1')).toEqual(new Set(['selected']))
    expect(stateOf(2, 'B0039:F2:Z2')).toEqual(new Set(['muted']))
    expect(stateOf(1)).toEqual(new Set(['hollow']))
    expect(stateOf(3)).toEqual(new Set(['hollow']))
    expect(overlay.hollow).toBe(true)
    expect(
      overlay.cells.features
        .filter((cell) => cell.properties.selected)
        .map((cell) => cell.properties.id),
    ).toEqual(['B0039:F2:Z1'])

    // A selected floor is solid with its zones; the others are hollow.
    workbench.execute({
      type: 'selection.set',
      input: { entityType: 'floor', ids: ['B0039:F1'] },
    })
    overlay = zoneOverlay(workbench.getState())
    const highlighted = overlay.cells.features.filter(
      (cell) => cell.properties.selected,
    )
    expect(highlighted.length).toBeGreaterThan(1)
    expect(highlighted.every((cell) => cell.properties.floor === 1)).toBe(true)
    expect(highlighted.every((cell) => cell.properties.state === 'floor')).toBe(
      true,
    )
    expect(overlay.focus?.level).toBe('floor')
  })

  it('bounds the geometry to the first selected buildings', () => {
    const workbench = zoned()
    const ids = workbench.getState().buildingIds.slice(0, 30)
    workbench.execute({
      type: 'selection.set',
      input: { entityType: 'building', ids },
    })
    const overlay = zoneOverlay(workbench.getState())
    expect(overlay.buildingIds).toHaveLength(MAX_ZONED_BUILDINGS)
    expect(overlay.omitted).toBe(30 - MAX_ZONED_BUILDINGS)
  })

  it('builds the legend from the zones drawn', () => {
    const single = createWorkbench({
      initialState: buildFixture('partway', NOW),
      now: NOW,
    })
    single.execute({
      type: 'selection.set',
      input: { entityType: 'building', ids: ['B0039'] },
    })
    expect(zoneOverlay(single.getState()).legend).toEqual([
      { kind: 'building', slots: [0] },
    ])
    // A building that kept perimeter and core beside one that fell back.
    const workbench = zoned()
    workbench.execute({
      type: 'selection.set',
      input: { entityType: 'building', ids: ['B0039', 'B0002'] },
    })
    const legend = zoneOverlay(workbench.getState()).legend
    expect(legend.map((row) => row.kind)).toEqual([
      'core',
      'perimeter',
      'floor',
    ])
    expect(legend[0]?.slots).toEqual([-1])
  })
})

describe('floors and zones view operations', () => {
  it('draws extruded buildings floor by floor or whole, and shows floors and zones in the Table', () => {
    const workbench = zoned()
    const view = createViewStore(workbench)
    expect(
      view.execute({
        type: 'map.setLayerStyle',
        input: { layerId: 'buildings', floorSlabs: false },
      }).outcome,
    ).toEqual({
      status: 'applied',
      summary: 'Map layer "Buildings": extruded buildings drawn whole.',
    })
    expect(
      view.execute({
        type: 'map.setLayerStyle',
        input: { layerId: 'grid-lines', floorSlabs: true },
      }).outcome,
    ).toMatchObject({ status: 'rejected', issues: [{ path: 'floorSlabs' }] })
    expect(
      view.execute({ type: 'table.setView', input: { view: 'zones' } }).outcome,
    ).toEqual({
      status: 'applied',
      summary: 'The table shows the zones of every building.',
    })
    expect(view.getState().table.view).toBe('zones')
    // Zooming names what is selected, and refuses what the map does not show.
    workbench.execute({
      type: 'selection.set',
      input: { entityType: 'zone', ids: ['B0039:F1:Z1'] },
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
})

describe('3D zones of the three zoning cases (decision 0034)', () => {
  const state = buildFixture('complete', NOW)
  const cases = {
    entityType: 'building' as const,
    ids: ['B0439', 'B0427', 'B0426'],
  }

  it('keeps each storey at its own height, its top less the slab gap', () => {
    expect(storeySpan({ number: 3, bottomM: 6.4, topM: 9.6 })).toEqual({
      base: 6.4,
      top: 9.28,
    })
    expect(storeySpan({ number: 1, bottomM: 0, topM: 3.2 })).toEqual({
      base: 0,
      top: 2.88,
    })
  })

  it('draws one cell per zone and storey for the three cases', () => {
    const overlay = zoneOverlay({ ...state, selection: cases })
    const count = (id: string) =>
      overlay.cells.features.filter((cell) => cell.properties.buildingId === id)
        .length
    expect(count('B0439')).toBe(25)
    expect(count('B0427')).toBe(9)
    expect(count('B0426')).toBe(15)
    expect(
      Math.max(
        ...overlay.cells.features
          .filter((cell) => cell.properties.buildingId === 'B0427')
          .map((cell) => cell.properties.top),
      ),
    ).toBe(28.48)
    expect(overlay.legend.map((row) => row.kind)).toEqual([
      'drawn',
      'floor',
      'core',
      'perimeter',
    ])
    // A floor of one building: the others keep their zones.
    const floor = zoneOverlay({
      ...state,
      selection: { entityType: 'floor', ids: ['B0427:F3'] },
    })
    expect(floor.buildingIds).toEqual(['B0427'])
    expect(floor.cells.features.map((cell) => cell.properties.state)).toEqual(
      Array.from({ length: 9 }, (_, index) =>
        index === 2 ? 'floor' : 'hollow',
      ),
    )
    // A whole-building zone selects no single floor, so nothing is hollow;
    // it is highlighted on every storey and the legend names it.
    const single = zoneOverlay({
      ...state,
      selection: { entityType: 'zone', ids: ['B0464:Z1'] },
    })
    expect(single.hollow).toBe(false)
    const storeys = single.cells.features.filter(
      (cell) => cell.properties.buildingId === 'B0464',
    )
    expect(storeys.length).toBeGreaterThan(1)
    expect(new Set(storeys.map((cell) => cell.properties.state))).toEqual(
      new Set(['selected']),
    )
    expect(single.focus).toEqual({
      buildingId: 'B0464',
      floors: storeys.map((cell) => cell.properties.floor),
      level: 'building zone',
    })
    // Its edges are the selected zone's.
    const [group] = zoneEdges(single.cells.features)
    expect(group?.edges.selected.length).toBeGreaterThan(0)
    expect(group?.edges.zone).toEqual([])
  })

  it('outlines every cell at its base and top with an upright per corner, by style', () => {
    const overlay = zoneOverlay({
      ...state,
      selection: { entityType: 'zone', ids: ['B0439:F2:Z2'] },
    })
    const edges = zoneEdges(overlay.cells.features)
    expect(edges.map((group) => group.buildingId)).toEqual(['B0439'])
    const corners = overlay.cells.features.reduce(
      (sum, cell) => sum + (cell.geometry.coordinates[0]?.length ?? 1) - 1,
      0,
    )
    const [group] = edges
    const length = (style: 'zone' | 'focus' | 'selected' | 'hollow') =>
      group?.edges[style].length ?? 0
    // Three segments per corner, six numbers per segment.
    expect(
      (length('zone') +
        length('focus') +
        length('selected') +
        length('hollow')) /
        6,
    ).toBe(corners * 3)
    // The selected zone (four corners) takes the selection colour; the
    // floor's other zones are emphasised; floors 1, 3, and 4 are hollow.
    expect(length('selected') / 18).toBe(4)
    expect(length('zone')).toBe(0)
    expect(length('focus') / 18).toBe(6 * 4)
    expect(length('hollow') / 18).toBe((5 + 7 + 6) * 4)
    // Six vertices of seven numbers per segment for the WebGL layer.
    const origin = [0.3, 0.37, 0] as [number, number, number]
    expect(edgeVertices(group?.edges.selected ?? [], origin)).toHaveLength(
      (length('selected') / 6) * 6 * 7,
    )
  })

  it('offsets the projection matrix to a building origin in double precision', () => {
    const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]
    expect([...translated(identity, [2, 3, 4])]).toEqual([
      1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 2, 3, 4, 1,
    ])
    expect(parseColor('#ff8000')).toEqual([1, 128 / 255, 0, 1])
    expect(parseColor('rgb(0, 255, 0)')).toEqual([0, 1, 0, 1])
  })

  it('opens a layer stack saved with the removed explodeFloors setting (decision 0035)', () => {
    const saved = defaultLayers().map((layer) => ({
      ...layer,
      explodeFloors: layer.kind === 'buildings',
    }))
    const read = parseStoredLayers(saved)
    expect(read).toEqual(defaultLayers())
    expect(read.some((layer) => 'explodeFloors' in layer)).toBe(false)
    // So the reopened project shows no unsaved change to its stack.
    expect(layersDiffer(defaultLayers(), saved)).toBe(false)
    expect(layerSummary(read.find((layer) => layer.id === 'buildings')!)).toBe(
      'Floors · extruded · 90%',
    )
    // The view operation no longer takes it.
    const workbench = createWorkbench({ initialState: state, now: NOW })
    const view = createViewStore(workbench)
    expect(
      view.execute({
        type: 'map.setLayerStyle',
        input: {
          layerId: 'buildings',
          explodeFloors: true,
        } as unknown as { layerId: string },
      }).outcome,
    ).toMatchObject({
      status: 'rejected',
      issues: [{ message: 'Nothing to change.' }],
    })
    expect(zonesLayer(view.getState().map.layers)?.id).toBe('buildings')
  })

  it('shows zones in 3D through the selection, the 3D view, and a zoom', () => {
    const workbench = createWorkbench({ initialState: state, now: NOW })
    const view = createViewStore(workbench)
    const opened: string[] = []
    const layout = { openPage: (page: string) => opened.push(page) }
    const layers = view.getState().map.layers
    expect(zones3dBlocker(state, layers, [])).toMatch(/^Select a building/)
    expect(zones3dBlocker(buildFixture('new', NOW), layers, ['B0439'])).toMatch(
      /has no zones yet/,
    )
    expect(
      zones3dBlocker(
        state,
        layers.map((layer) => ({ ...layer, extrude: false })),
        ['B0439'],
      ),
    ).toMatch(/^No shown building layer extrudes/)
    expect(zones3dBlocker(state, layers, ['B0439'])).toBeNull()
    showZonesIn3d(
      {
        workbench,
        view,
        layout: layout as unknown as Parameters<
          typeof showZonesIn3d
        >[0]['layout'],
      },
      ['B0439'],
    )
    expect(workbench.getState().selection).toEqual({
      entityType: 'building',
      ids: ['B0439'],
    })
    expect(view.getState().map.view3d).toBe(true)
    expect(view.getState().map.focusRequest).toBe(1)
    expect(opened).toEqual(['map'])
  })
})

describe('review fixes (decision 0034)', () => {
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

  it('keeps a large selection and says how many buildings get zones', () => {
    const state = buildFixture('complete', NOW)
    const workbench = createWorkbench({ initialState: state, now: NOW })
    const view = createViewStore(workbench)
    const ids = state.buildingIds.slice(0, MAX_ZONED_BUILDINGS + 5)
    showZonesIn3d(
      {
        workbench,
        view,
        layout: { openPage: () => undefined } as unknown as Parameters<
          typeof showZonesIn3d
        >[0]['layout'],
      },
      ids,
    )
    expect(workbench.getState().selection.ids).toHaveLength(ids.length)
    const last = workbench.store.getState().log.at(-1)
    expect(last?.summary).toBe(
      `Zoomed the map to ${ids.length} selected building(s). Zones are drawn for the first ${MAX_ZONED_BUILDINGS} of ${ids.length} buildings.`,
    )
  })
})
