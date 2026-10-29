import { describe, expect, it } from 'vitest'
import { runStageNow } from '../../domain/jobs/runNow.ts'
import { createWorkbench } from '../../domain/workbench.ts'
import { STAGE_IDS } from '../../domain/workflow.ts'
import { buildFixture } from '../../server/fixtures.ts'
import { createViewStore } from '../view/viewStore.ts'
import { METRICS, computeMetric, type MetricId } from './mapMetrics.ts'
import {
  EXPLODE_GAP_SHARE,
  MAX_ZONED_BUILDINGS,
  slabFeatures,
  storeySpan,
  zoneEdges,
  zoneOverlay,
} from './zoneFeatures.ts'
import { edgeVertices, parseColor, translated } from './ZoneEdgeLayer.tsx'
import { layerSummary, parseStoredLayers, zonesLayer } from './mapLayers.ts'
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

  it('draws the zones of selected buildings only, and cuts away floors above a selected zone', () => {
    const workbench = zoned()
    expect(zoneOverlay(workbench.getState()).cells.features).toEqual([])
    workbench.execute({
      type: 'selection.set',
      input: { entityType: 'building', ids: ['B0039'] },
    })
    let overlay = zoneOverlay(workbench.getState())
    expect(overlay.buildingIds).toEqual(['B0039'])
    expect(overlay.kinds.sort()).toEqual(['core', 'perimeter'])
    expect(overlay.cutAbove).toBeNull()
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
    expect(overlay.cut?.buildingId).toBe('B0039')
    expect(
      Math.max(...overlay.cells.features.map((cell) => cell.properties.floor)),
    ).toBe(2)
    expect(
      overlay.cells.features
        .filter((cell) => cell.properties.selected)
        .map((cell) => cell.properties.id),
    ).toEqual(['B0039:F2:Z1'])

    // A selected floor highlights every zone on it.
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

  it('lifts each storey by its share of a floor when exploded', () => {
    const floor = { number: 3, bottomM: 6.4, topM: 9.6 }
    expect(storeySpan(floor, false)).toEqual({ base: 6.4, top: 9.28 })
    // Two storeys below, each opening a gap of 0.8 of the floor height.
    expect(storeySpan(floor, true)).toEqual({
      base: Math.round((6.4 + 2 * 3.2 * EXPLODE_GAP_SHARE) * 100) / 100,
      top: Math.round((9.28 + 2 * 3.2 * EXPLODE_GAP_SHARE) * 100) / 100,
    })
    expect(storeySpan({ number: 1, bottomM: 0, topM: 3.2 }, true)).toEqual({
      base: 0,
      top: 2.88,
    })
  })

  it('draws one cell per zone and storey, and their tops as drawn', () => {
    const closed = zoneOverlay({ ...state, selection: cases })
    const exploded = zoneOverlay(
      { ...state, selection: cases },
      { explode: true },
    )
    const count = (overlay: typeof closed, id: string) =>
      overlay.cells.features.filter((cell) => cell.properties.buildingId === id)
        .length
    for (const overlay of [closed, exploded]) {
      expect(count(overlay, 'B0439')).toBe(25)
      expect(count(overlay, 'B0427')).toBe(9)
      expect(count(overlay, 'B0426')).toBe(15)
    }
    expect(closed.exploded).toBe(false)
    expect(exploded.exploded).toBe(true)
    expect(closed.topsM.B0427).toBe(28.48)
    expect(exploded.topsM.B0427).toBeCloseTo(
      28.48 + 8 * 3.2 * EXPLODE_GAP_SHARE,
      2,
    )
    expect(exploded.legend.map((row) => row.kind)).toEqual([
      'drawn',
      'floor',
      'core',
      'perimeter',
    ])
    // A cut storey's top is drawn exploded too.
    const cut = zoneOverlay(
      {
        ...state,
        selection: { entityType: 'floor', ids: ['B0427:F3'] },
      },
      { explode: true },
    )
    expect(cut.cut).toEqual({
      buildingId: 'B0427',
      topM: storeySpan({ number: 3, bottomM: 6.4, topM: 9.6 }, true).top,
    })
    expect(cut.topsM.B0427).toBe(cut.cut?.topM)
  })

  it('outlines every cell at its base and top with an upright per corner', () => {
    const overlay = zoneOverlay(
      { ...state, selection: { entityType: 'zone', ids: ['B0439:F2:Z2'] } },
      { explode: true },
    )
    const edges = zoneEdges(overlay.cells.features)
    expect(edges.map((group) => group.buildingId)).toEqual(['B0439'])
    const corners = overlay.cells.features.reduce(
      (sum, cell) => sum + (cell.geometry.coordinates[0]?.length ?? 1) - 1,
      0,
    )
    const [group] = edges
    // Three segments per corner, six numbers per segment.
    expect(
      ((group?.edges.length ?? 0) + (group?.selected.length ?? 0)) / 6,
    ).toBe(corners * 3)
    // The selected zone's edges are kept apart for the selection colour.
    expect((group?.selected.length ?? 0) / 18).toBe(4)
    // Six vertices of seven numbers per segment for the WebGL layer.
    const origin = [0.3, 0.37, 0] as [number, number, number]
    expect(edgeVertices(group?.selected ?? [], origin)).toHaveLength(
      ((group?.selected.length ?? 0) / 6) * 6 * 7,
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

  it('explodes floors as a building layer setting saved with the stack', () => {
    const workbench = createWorkbench({ initialState: state, now: NOW })
    const view = createViewStore(workbench)
    expect(zonesLayer(view.getState().map.layers)?.explodeFloors).toBe(false)
    expect(
      view.execute({
        type: 'map.setLayerStyle',
        input: { layerId: 'buildings', explodeFloors: true },
      }).outcome,
    ).toEqual({
      status: 'applied',
      summary:
        'Map layer "Buildings": floors of zoned buildings exploded in 3D.',
    })
    expect(
      view.execute({
        type: 'map.setLayerStyle',
        input: { layerId: 'grid-points', explodeFloors: true },
      }).outcome,
    ).toMatchObject({ status: 'rejected', issues: [{ path: 'explodeFloors' }] })
    // Stacks saved before the setting read as not exploded.
    const stored = view.getState().map.layers.map((layer) => {
      const { explodeFloors: _dropped, ...rest } = layer
      void _dropped
      return rest
    })
    expect(
      parseStoredLayers(stored).every((layer) => !layer.explodeFloors),
    ).toBe(true)
    expect(
      layerSummary(
        view.getState().map.layers.find((layer) => layer.id === 'buildings')!,
      ),
    ).toContain('zoned floors exploded')
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
