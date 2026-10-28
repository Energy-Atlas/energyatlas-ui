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
  zoneOverlay,
} from './zoneFeatures.ts'

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
  })
})
