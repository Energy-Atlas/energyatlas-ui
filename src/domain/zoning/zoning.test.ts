import { describe, expect, test } from 'vitest'
import { buildFixture } from '../../server/fixtures.ts'
import { projectStateSchema } from '../../server/projectSchema.ts'
import { runStageNow } from '../jobs/runNow.ts'
import type { Building, LngLat, WorkbenchState } from '../types.ts'
import { createWorkbench } from '../workbench.ts'
import { STAGE_IDS, deriveStageStates } from '../workflow.ts'
import {
  area,
  cleanRing,
  groupEdges,
  insetRing,
  isSimple,
  type Point,
} from './geometry.ts'
import {
  buildingZoning,
  apportion,
  buildingFloors,
  demandShares,
  floorExists,
  perimeterCorePlan,
  selectedBuildingIds,
  zoneBuilding,
  zoneExists,
} from './zoning.ts'

const NOW = () => new Date('2026-10-28T12:00:00Z')
const stagesOf = (state: WorkbenchState) =>
  deriveStageStates(state.workflow, state.tasks)

const rectangle = (width: number, depth: number): Point[] => [
  [0, 0],
  [width, 0],
  [width, depth],
  [0, depth],
]

/** An L: a 30 m by 10 m bar with a 10 m by 20 m wing. */
const ell: Point[] = [
  [0, 0],
  [30, 0],
  [30, 10],
  [10, 10],
  [10, 30],
  [0, 30],
]

describe('footprint geometry', () => {
  test('cleans closing, repeated, and straight points and turns the ring counter-clockwise', () => {
    const clockwise: Point[] = [
      [0, 0],
      [0, 10],
      [0, 10.02],
      [10, 10],
      [10, 5],
      [10, 0],
      [0, 0],
    ]
    const ring = cleanRing(clockwise)
    expect(ring).toHaveLength(4)
    expect(area(ring ?? [])).toBeCloseTo(100, 0)
    expect(
      cleanRing([
        [0, 0],
        [1, 0],
        [2, 0],
      ]),
    ).toBeNull()
  })

  test('insets a convex footprint by the depth on every side', () => {
    const inset = insetRing(rectangle(20, 30), 4.5)
    expect(inset.ok).toBe(true)
    if (inset.ok) expect(area(inset.core)).toBeCloseTo(11 * 21, 6)
  })

  test('insets a concave footprint with mitred corners', () => {
    const inset = insetRing(ell, 3)
    expect(inset.ok).toBe(true)
    if (!inset.ok) return
    // The core is the L 3 m in: (30-6)*(10-6) + (10-6)*(30-10) less overlap.
    expect(area(inset.core)).toBeCloseTo(24 * 4 + 4 * 20, 6)
    expect(inset.core[3]).toEqual([7, 7])
  })

  test('refuses an inset that collapses, crosses the perimeter, or starts from a self-touching ring', () => {
    expect(insetRing(rectangle(8, 40), 4.5)).toEqual({
      ok: false,
      failure: 'edge_collapsed',
    })
    // The L's wing is 10 m wide: a 6 m band cannot fit on both sides.
    expect(insetRing(ell, 6).ok).toBe(false)
    const pinched: Point[] = [
      [0, 0],
      [10, 0],
      [10, 10],
      [5, 0],
      [0, 10],
    ]
    expect(isSimple(pinched)).toBe(false)
    expect(insetRing(pinched, 1)).toEqual({ ok: false, failure: 'not_simple' })
  })

  test('joins edges shorter than the depth to the zone before them', () => {
    const jogged: Point[] = [
      [0, 0],
      [20, 0],
      [20, 9],
      [21, 9],
      [21, 20],
      [0, 20],
    ]
    expect(groupEdges(jogged, 4.5)).toEqual([[0], [1, 2], [3], [4], [5]])
    // Fewer than three long edges: every edge keeps its own zone.
    expect(groupEdges(rectangle(3, 20), 4.5)).toEqual([[0], [1], [2], [3]])
  })
})

const fixture = buildFixture('partway', NOW)

function footprintOf(id: string): Building {
  const building = fixture.buildings[id]
  if (!building) throw new Error(`No building ${id} in the fixture.`)
  return building
}

function planOf(building: Building) {
  const [lng0, lat0] = building.footprint[0] ?? [0, 0]
  const perLng = 111_320 * Math.cos((lat0 * Math.PI) / 180)
  return perimeterCorePlan(
    building.footprint.map(([lng, lat]): Point => [
      (lng - lng0) * perLng,
      (lat - lat0) * 111_320,
    ]),
    4.5,
  )
}

const PERIMETER_CORE = { mode: 'perimeterCore', perimeterDepthM: 4.5 } as const

describe('zoning OpenStreetMap footprints from the fixture', () => {
  test('a convex footprint gets a core and one perimeter zone per edge, covering the floor', () => {
    const building = footprintOf('B0039')
    const zoning = zoneBuilding(building, PERIMETER_CORE)
    expect(zoning?.appliedMode).toBe('perimeterCore')
    expect(zoning?.fallback).toBeNull()
    const floor1 = zoning?.zones.filter((zone) => zone.floor === 1) ?? []
    expect(floor1[0]?.kind).toBe('core')
    expect(floor1.slice(1).every((zone) => zone.kind === 'perimeter')).toBe(
      true,
    )
    const covered = floor1.reduce((sum, zone) => sum + zone.areaM2, 0)
    expect(covered).toBeCloseTo(building.footprintAreaM2, 0)
    // Neighbouring perimeter zones never share a colour.
    const slots = floor1.slice(1).map((zone) => zone.colorSlot)
    slots.forEach((slot, index) =>
      expect(slot).not.toBe(slots[(index + 1) % slots.length]),
    )
  })

  test('a concave footprint is zoned and its zones cover the floor', () => {
    const building = footprintOf('B0464')
    const plan = planOf(building)
    expect('zones' in plan).toBe(true)
    const zoning = zoneBuilding(building, PERIMETER_CORE)
    const floor1 = zoning?.zones.filter((zone) => zone.floor === 1) ?? []
    expect(floor1.length).toBeGreaterThan(5)
    expect(floor1.reduce((sum, zone) => sum + zone.areaM2, 0)).toBeCloseTo(
      building.footprintAreaM2,
      0,
    )
  })

  test('a tiny or narrow footprint falls back to one zone per floor and says why', () => {
    for (const id of ['B0001', 'B0002']) {
      const zoning = zoneBuilding(footprintOf(id), PERIMETER_CORE)
      expect(zoning?.appliedMode).toBe('floors')
      expect(zoning?.fallback?.code).toBe('perimeter_inset_failed')
      expect(zoning?.zones).toHaveLength(zoning?.floors.length ?? -1)
      expect(zoning?.zones.every((zone) => zone.kind === 'floor')).toBe(true)
    }
  })

  test('a core below the minimum falls back', () => {
    const zoning = zoneBuilding(footprintOf('B0020'), PERIMETER_CORE)
    expect(zoning?.fallback?.code).toBe('core_too_small')
    expect(zoning?.fallback?.message).toMatch(/core of \d+ m²/)
  })

  test('a self-touching footprint falls back (the fixture has none, so one is pinched from B0039)', () => {
    // Every one of the 464 fixture footprints is simple; repeating a corner
    // further along pinches B0039's outline into one that touches itself.
    const building = footprintOf('B0039')
    const ring = building.footprint.slice(0, -1)
    const pinched: LngLat[] = [
      ...ring.slice(0, 3),
      ring[1] ?? [0, 0],
      ...ring.slice(3),
      ring[0] ?? [0, 0],
    ]
    const zoning = zoneBuilding(
      { ...building, footprint: pinched },
      PERIMETER_CORE,
    )
    expect(zoning?.fallback?.code).toBe('footprint_not_simple')
    expect(zoning?.appliedMode).toBe('floors')
  })

  test('floors are uniform and zones follow the mode', () => {
    const building = footprintOf('B0039')
    const single = zoneBuilding(building, {
      mode: 'single',
      perimeterDepthM: 4.5,
    })
    const floors = building.floors ?? 0
    expect(single?.floors).toHaveLength(floors)
    expect(single?.floorHeightM).toBeCloseTo((building.heightM ?? 0) / floors)
    expect(single?.zones).toEqual([
      expect.objectContaining({
        id: 'B0039:Z1',
        kind: 'building',
        areaM2: Math.round(building.footprintAreaM2 * floors * 100) / 100,
      }),
    ])
    expect(single?.floors[0]?.zoneIds).toEqual(['B0039:Z1'])
    const byFloor = zoneBuilding(building, {
      mode: 'floors',
      perimeterDepthM: 4.5,
    })
    expect(byFloor?.zones.map((zone) => zone.id)).toEqual(
      Array.from({ length: floors }, (_, index) => `B0039:F${index + 1}:Z1`),
    )
    expect(byFloor?.zones.at(-1)?.topM).toBeCloseTo(building.heightM ?? 0)
    // No height yet: no floors or zones.
    expect(
      zoneBuilding({ ...building, heightM: null }, PERIMETER_CORE),
    ).toBeNull()
  })

  test('the synthetic demand split adds up to the building total', () => {
    const zoning = zoneBuilding(footprintOf('B0464'), PERIMETER_CORE)
    if (!zoning) throw new Error('No zoning.')
    const shares = demandShares(zoning, 123_456)
    const sum = (values: Record<string, number>) =>
      Object.values(values).reduce((total, value) => total + value, 0)
    expect(sum(shares.zones)).toBe(123_456)
    expect(sum(shares.floors)).toBe(123_456)
    // A total that is not whole still adds up, rounded, in whole kWh.
    const odd = demandShares(zoning, 98_765.4321)
    expect(sum(odd.zones)).toBe(98_765)
    expect(Object.values(odd.zones).every(Number.isInteger)).toBe(true)
  })

  test('apportions whole numbers by largest remainders', () => {
    expect(apportion([1, 1, 1], 100)).toEqual([34, 33, 33])
    expect(apportion([2, 1], 10)).toEqual([7, 3])
    expect(apportion([1, 1], 0.6)).toEqual([1, 0])
    expect(apportion([0, 0], 5)).toEqual([5, 0])
    expect(apportion([], 5)).toEqual([])
  })
})

function preprocessed(): ReturnType<typeof createWorkbench> {
  return createWorkbench({
    initialState: buildFixture('partway', NOW),
    now: NOW,
  })
}

describe('the zoning setting', () => {
  test('outdates Geospatial preprocessing and later stages, and a rerun publishes the new zones', () => {
    const workbench = preprocessed()
    const before = workbench.getState()
    expect(before.zoning.published).toMatchObject({ mode: 'single' })
    expect(before.buildings.B0039?.zoneCount).toBe(1)
    const states = stagesOf(before)
    expect(states[STAGE_IDS.preprocessing]).toBe('executed')

    const set = workbench.execute({
      type: 'zoning.set',
      input: { mode: 'perimeterCore', perimeterDepthM: 4.5 },
    })
    expect(set.outcome.status).toBe('applied')
    const after = stagesOf(workbench.getState())
    expect(after[STAGE_IDS.preprocessing]).toBe('stale')
    // Zones still follow the published zoning until the stage runs again.
    expect(buildingZoning(workbench.getState(), 'B0039')?.zones).toHaveLength(1)

    const run = runStageNow(workbench, STAGE_IDS.preprocessing)
    expect(run.outcome.status).toBe('applied')
    const state = workbench.getState()
    expect(stagesOf(state)[STAGE_IDS.preprocessing]).toBe('executed')
    expect(state.zoning.published).toMatchObject({
      mode: 'perimeterCore',
      perimeterDepthM: 4.5,
    })
    const zoning = buildingZoning(state, 'B0039')
    expect(state.buildings.B0039?.zoneCount).toBe(zoning?.zones.length)
    expect(zoning?.zones.length).toBeGreaterThan(
      state.buildings.B0039?.floors ?? 0,
    )
    // RC-style coded warnings name the buildings that fell back.
    const warnings = state.issues.filter(
      (issue) => issue.stageId === STAGE_IDS.preprocessing,
    )
    expect(warnings.map((issue) => issue.message.split(':')[0])).toEqual(
      expect.arrayContaining(['perimeter_inset_failed', 'core_too_small']),
    )
  })

  test('waits for preprocessing, and invalidates a later stage queued on the old zoning', () => {
    const workbench = preprocessed()
    workbench.execute({
      type: 'workflow.runStage',
      input: { stageId: STAGE_IDS.preprocessing },
    })
    expect(
      workbench.execute({ type: 'zoning.set', input: { mode: 'floors' } })
        .outcome,
    ).toMatchObject({ status: 'rejected' })
    const preprocessingTask = workbench.getState().taskIds.at(-1) ?? ''
    workbench.execute({
      type: 'task.cancel',
      input: { taskId: preprocessingTask },
    })

    workbench.execute({
      type: 'workflow.runStage',
      input: { stageId: STAGE_IDS.shading },
    })
    const taskId = workbench.getState().taskIds.at(-1) ?? ''
    expect(
      workbench.execute({ type: 'zoning.set', input: { mode: 'floors' } })
        .outcome.status,
    ).toBe('applied')
    workbench.execute({ type: 'task.start', input: { taskId } }, 'system')
    // The input signature records preprocessing's edit revision.
    expect(workbench.getState().tasks[taskId]?.status).toBe('invalidated')
  })

  test('refuses an unchanged setting and a depth out of range on its field', () => {
    const workbench = preprocessed()
    const same = workbench.execute({
      type: 'zoning.set',
      input: { mode: 'single' },
    })
    expect(same.outcome).toMatchObject({
      status: 'rejected',
      issues: [{ path: 'mode' }],
    })
    const deep = workbench.execute({
      type: 'zoning.set',
      input: { mode: 'perimeterCore', perimeterDepthM: 40 },
    })
    expect(deep.outcome).toMatchObject({
      status: 'rejected',
      issues: [
        { path: 'perimeterDepthM', message: 'Use a depth from 1 to 15 m.' },
      ],
    })
    // A depth kept for later changes no zone and outdates nothing, once no
    // building overridden to perimeter and core uses it (decision 0034).
    workbench.execute({
      type: 'zoning.setBuilding',
      input: { buildingId: 'B0426', mode: 'default' },
    })
    runStageNow(workbench, STAGE_IDS.preprocessing)
    const kept = workbench.execute({
      type: 'zoning.set',
      input: { mode: 'single', perimeterDepthM: 3 },
    })
    expect(kept.outcome.status).toBe('applied')
    expect(stagesOf(workbench.getState())[STAGE_IDS.preprocessing]).toBe(
      'executed',
    )
  })

  test('slices floors from the storeys the last run used until it runs again', () => {
    const workbench = preprocessed()
    const before = buildingFloors(workbench.getState(), 'B0039')
    const storeys = workbench.getState().buildings.B0039?.floors ?? 0
    expect(workbench.getState().zoning.published?.storeys.B0039).toBe(storeys)
    workbench.execute({
      type: 'edits.propose',
      input: { entityId: 'B0039', field: 'floors', value: storeys * 2 },
    })
    expect(
      workbench.execute({ type: 'edits.apply', input: {} }).outcome.status,
    ).toBe('applied')
    const edited = workbench.getState()
    expect(edited.buildings.B0039?.floors).toBe(storeys * 2)
    // Floors, zones, and selectable ids stay as the run published them.
    expect(buildingFloors(edited, 'B0039')).toEqual(before)
    expect(buildingZoning(edited, 'B0039')?.zones).toHaveLength(1)
    expect(floorExists(edited, `B0039:F${storeys + 1}`)).toBe(false)
    expect(stagesOf(edited)[STAGE_IDS.preprocessing]).toBe('stale')
    // A rerun slices the new storeys.
    runStageNow(workbench, STAGE_IDS.enrichment)
    runStageNow(workbench, STAGE_IDS.schema)
    runStageNow(workbench, STAGE_IDS.preprocessing)
    const rerun = workbench.getState()
    expect(buildingFloors(rerun, 'B0039')).toHaveLength(storeys * 2)
    expect(floorExists(rerun, `B0039:F${storeys + 1}`)).toBe(true)
  })

  test('selects floors and zones by id, and refuses ids that do not exist', () => {
    const workbench = preprocessed()
    const zoned = workbench.getState()
    const building = zoned.buildings.B0039?.name
    const zone = buildingZoning(zoned, 'B0039')?.zones[0]
    // One floor or zone is named in the summary; several are counted.
    expect(
      workbench.execute({
        type: 'selection.set',
        input: { entityType: 'zone', ids: ['B0039:Z1'] },
      }).outcome,
    ).toMatchObject({
      status: 'applied',
      summary: `Selected zone ${zone?.name} of ${building}.`,
    })
    expect(
      workbench.execute({
        type: 'selection.set',
        input: { entityType: 'floor', ids: ['B0039:F1'] },
      }).outcome,
    ).toMatchObject({ summary: `Selected floor 1 of ${building}.` })
    expect(
      workbench.execute({
        type: 'selection.set',
        input: { entityType: 'floor', ids: ['B0039:F1', 'B0039:F2'] },
      }).outcome,
    ).toMatchObject({ summary: 'Selected 2 floor(s).' })
    workbench.execute({
      type: 'selection.set',
      input: { entityType: 'zone', ids: ['B0039:Z1'] },
    })
    expect(selectedBuildingIds(workbench.getState().selection)).toEqual([
      'B0039',
    ])
    expect(
      workbench.execute({
        type: 'selection.set',
        input: { entityType: 'floor', ids: ['B0039:F1', 'B0039:F99'] },
      }).outcome,
    ).toMatchObject({ status: 'rejected', issues: [{ path: 'ids' }] })
    const state = workbench.getState()
    expect(floorExists(state, 'B0039:F1')).toBe(true)
    expect(zoneExists(state, 'B0039:F1:Z1')).toBe(false)
  })
})

describe('saved projects and packages from before zoning', () => {
  test('load with the default setting and no published zoning', () => {
    const saved = JSON.parse(JSON.stringify(fixture)) as Record<string, unknown>
    delete saved.zoning
    const parsed = projectStateSchema.parse(saved)
    expect(parsed.zoning).toEqual({
      mode: 'single',
      perimeterDepthM: 4.5,
      overrides: {},
      drawn: {},
      published: null,
    })
    // Floors still follow storeys and heights; zones wait for a rerun.
    expect(buildingZoning(parsed, 'B0039')).toBeNull()
    expect(floorExists(parsed, 'B0039:F1')).toBe(true)
    // Building totals and zone counts saved before stay as they were.
    expect(parsed.buildings).toEqual(fixture.buildings)
  })

  test('round-trip the setting and the published zoning', () => {
    const workbench = preprocessed()
    workbench.execute({
      type: 'zoning.set',
      input: { mode: 'perimeterCore', perimeterDepthM: 3.5 },
    })
    runStageNow(workbench, STAGE_IDS.preprocessing)
    const state = workbench.getState()
    const parsed = projectStateSchema.parse(JSON.parse(JSON.stringify(state)))
    expect(parsed.zoning).toEqual(state.zoning)
    // A published zoning without storeys reads as none recorded.
    const saved = JSON.parse(JSON.stringify(state)) as {
      zoning: { published: Record<string, unknown> }
    }
    delete saved.zoning.published.storeys
    expect(projectStateSchema.parse(saved).zoning.published?.storeys).toEqual(
      {},
    )
  })
})
