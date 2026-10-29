import { describe, expect, test } from 'vitest'
import { buildFixture } from '../../server/fixtures.ts'
import { projectStateSchema } from '../../server/projectSchema.ts'
import { runStageNow } from '../jobs/runNow.ts'
import type { WorkbenchState } from '../types.ts'
import { createWorkbench } from '../workbench.ts'
import { STAGE_IDS, deriveStageStates } from '../workflow.ts'
import { drawnPlanProblem, type PlanePlan, type PlaneZone } from './drawn.ts'
import {
  DRAWN_FIXTURE_BUILDING,
  FIXTURE_ZONING_OVERRIDES,
  fixtureDrawnZones,
} from './drawnFixture.ts'
import type { Point } from './geometry.ts'
import {
  buildingZoning,
  buildingZoningChanged,
  describeAppliedZoning,
  fallbackWarnings,
  publishedZoningOf,
  resolveBuildingZoning,
  zoneBuilding,
  zoneTypeLabel,
  zoningFallbacks,
} from './zoning.ts'

// Per-building zoning and drawn zones (decision 0034).

const NOW = () => new Date('2026-10-29T12:00:00Z')
const stagesOf = (state: WorkbenchState) =>
  deriveStageStates(state.workflow, state.tasks)

/** A 20 m by 10 m footprint. */
const FOOTPRINT: Point[] = [
  [0, 0],
  [20, 0],
  [20, 10],
  [0, 10],
]

const box = (
  name: string,
  [x0, y0]: Point,
  [x1, y1]: Point,
  use: PlaneZone['use'] = 'office',
): PlaneZone => ({
  name,
  use,
  ring: [
    [x0, y0],
    [x1, y0],
    [x1, y1],
    [x0, y1],
  ],
})

/** An office floor: two offices either side of a corridor, with a core. */
const OFFICES: PlaneZone[] = [
  box('core', [8, 6], [12, 10], 'core'),
  box('office west', [0, 0], [8, 10]),
  box('corridor', [8, 0], [12, 6], 'corridor'),
  box('office east', [12, 0], [20, 10]),
]

const plan = (zones: PlaneZone[], fromFloor = 1, toFloor = 2): PlanePlan => ({
  fromFloor,
  toFloor,
  zones,
})

describe('drawn zones are checked against the footprint', () => {
  test('a plan that tiles the floor is valid', () => {
    expect(drawnPlanProblem(FOOTPRINT, [plan(OFFICES)], 2)).toBeNull()
  })

  test('floors may differ: a ground floor with a lobby and offices above', () => {
    const ground = [
      box('lobby', [0, 0], [20, 6], 'lobby'),
      box('core', [8, 6], [12, 10], 'core'),
      box('retail west', [0, 6], [8, 10], 'retail'),
      box('retail east', [12, 6], [20, 10], 'retail'),
    ]
    expect(
      drawnPlanProblem(FOOTPRINT, [plan(ground, 1, 1), plan(OFFICES, 2, 5)], 5),
    ).toBeNull()
  })

  test('refuses no plans, floors not covered, and floors covered twice', () => {
    expect(drawnPlanProblem(FOOTPRINT, [], 2)?.code).toBe('drawn_zones_missing')
    const missing = drawnPlanProblem(FOOTPRINT, [plan(OFFICES, 1, 2)], 4)
    expect(missing?.code).toBe('drawn_floors_mismatch')
    expect(missing?.message).toContain('floors 3, 4 of 4')
    const doubled = drawnPlanProblem(
      FOOTPRINT,
      [plan(OFFICES, 1, 2), plan(OFFICES, 2, 2)],
      2,
    )
    expect(doubled?.message).toContain('floor 2 has more than one drawn plan')
    expect(
      drawnPlanProblem(FOOTPRINT, [plan(OFFICES, 1, 3)], 2)?.message,
    ).toContain('describe floor 3, but the building has 2 floors')
  })

  test('refuses a zone that touches itself, leaves the footprint, or overlaps another', () => {
    const bowtie: PlaneZone = {
      name: 'bowtie',
      use: 'office',
      ring: [
        [0, 0],
        [8, 10],
        [8, 0],
        [0, 10],
      ],
    }
    expect(
      drawnPlanProblem(FOOTPRINT, [plan([bowtie, ...OFFICES.slice(1)])], 2)
        ?.code,
    ).toBe('drawn_zone_not_simple')
    const outside = drawnPlanProblem(
      FOOTPRINT,
      [plan([...OFFICES.slice(0, 3), box('office east', [12, 0], [21.5, 10])])],
      2,
    )
    expect(outside?.code).toBe('drawn_zone_outside')
    expect(outside?.message).toContain('by up to 1.5 m')
    // A tolerance absorbs a corner a few centimetres out.
    expect(
      drawnPlanProblem(
        FOOTPRINT,
        [
          plan([
            ...OFFICES.slice(0, 3),
            box('office east', [12, 0], [20.1, 10]),
          ]),
        ],
        2,
      ),
    ).toBeNull()
    const overlap = drawnPlanProblem(
      FOOTPRINT,
      [plan([...OFFICES, box('meeting room', [4, 2], [10, 5])])],
      2,
    )
    expect(overlap?.code).toBe('drawn_zones_overlap')
    expect(overlap?.message).toContain('"office west" and "meeting room"')
    // The same zone twice overlaps too, though no corner is inside the other.
    expect(
      drawnPlanProblem(FOOTPRINT, [plan([...OFFICES, OFFICES[1]!])], 2)?.code,
    ).toBe('drawn_zones_overlap')
  })

  test('refuses zones that leave part of the floor uncovered', () => {
    const gap = drawnPlanProblem(FOOTPRINT, [plan(OFFICES.slice(0, 3))], 2)
    expect(gap?.code).toBe('drawn_zones_gap')
    expect(gap?.message).toContain('cover 60% of the floor, less than 98%')
  })
})

describe('the fixtures zone three neighbouring buildings their own way', () => {
  const state = buildFixture('complete', NOW)

  test('the complete fixture stores drawn zones and applies the overrides', () => {
    expect(Object.keys(state.zoning.drawn)).toEqual([DRAWN_FIXTURE_BUILDING])
    expect(state.zoning.overrides).toEqual(FIXTURE_ZONING_OVERRIDES)
    expect(state.zoning.published?.overrides).toEqual(FIXTURE_ZONING_OVERRIDES)
    expect(state.zoning.published?.mode).toBe('single')
    // Neighbours, so one view frames all three.
    const centroid = (id: string) => {
      const ring = state.buildings[id]?.footprint ?? []
      return [
        ring.reduce((sum, point) => sum + point[0], 0) / ring.length,
        ring.reduce((sum, point) => sum + point[1], 0) / ring.length,
      ] as const
    }
    const [x, y] = centroid('B0439')
    for (const id of ['B0426', 'B0427']) {
      const [ox, oy] = centroid(id)
      expect(Math.hypot((ox - x) * 82_000, (oy - y) * 111_000)).toBeLessThan(40)
    }
  })

  test('each case gets its own zones, and every other building the default', () => {
    const drawn = buildingZoning(state, 'B0439')
    expect(drawn?.appliedMode).toBe('drawn')
    expect(drawn?.fallback).toBeNull()
    expect(drawn?.zones).toHaveLength(25)
    expect(drawn?.zones[0]).toMatchObject({
      id: 'B0439:F1:Z1',
      name: 'Floor 1 core',
      kind: 'drawn',
      use: 'core',
      colorSlot: null,
    })
    expect(zoneTypeLabel(drawn!.zones[1]!)).toBe('Drawn: lobby')
    // Floors differ: shops below, flats above, a penthouse on top.
    const names = (floor: number) =>
      drawn?.zones
        .filter((zone) => zone.floor === floor)
        .map((zone) => zone.name.replace(`Floor ${floor} `, ''))
    expect(names(1)).toEqual([
      'core',
      'lobby',
      'bike and mail room',
      'retail east',
      'retail west',
    ])
    expect(names(2)).toContain('apartment southeast')
    expect(names(4)).toContain('penthouse')
    // A floor's zones add up to the footprint area.
    const footprint = state.buildings.B0439?.footprintAreaM2 ?? 0
    for (const floor of [1, 2, 3, 4]) {
      const sum = drawn!.zones
        .filter((zone) => zone.floor === floor)
        .reduce((total, zone) => total + zone.areaM2, 0)
      expect(sum).toBeCloseTo(footprint, 0)
    }
    expect(buildingZoning(state, 'B0427')).toMatchObject({
      appliedMode: 'floors',
      fallback: null,
    })
    expect(buildingZoning(state, 'B0427')?.zones).toHaveLength(9)
    const perimeter = buildingZoning(state, 'B0426')
    expect(perimeter).toMatchObject({
      appliedMode: 'perimeterCore',
      fallback: null,
    })
    expect(perimeter?.zones).toHaveLength(15)
    expect(buildingZoning(state, 'B0464')?.zones).toHaveLength(1)
    expect(publishedZoningOf(state, 'B0439')?.source).toBe('override')
    expect(publishedZoningOf(state, 'B0464')?.source).toBe('default')
  })

  test('the zone total changes from 464 to 510 and names the overrides', () => {
    const total = state.buildingIds.reduce(
      (sum, id) => sum + (state.buildings[id]?.zoneCount ?? 0),
      0,
    )
    expect(total).toBe(510)
    expect(state.assets['asset:zones']?.summary).toBe(
      '510 zones, one zone per building; 3 buildings zoned their own way',
    )
  })

  test('the new fixture stores the drawn zones but overrides nothing', () => {
    const fresh = buildFixture('new', NOW)
    expect(Object.keys(fresh.zoning.drawn)).toEqual([DRAWN_FIXTURE_BUILDING])
    expect(fresh.zoning.overrides).toEqual({})
  })
})

describe('drawn zones fall back to one zone per floor, with a coded reason', () => {
  const state = buildFixture('complete', NOW)

  test('a building without drawn zones', () => {
    const building = state.buildings.B0039!
    const zoning = zoneBuilding(building, {
      mode: 'drawn',
      perimeterDepthM: 4.5,
    })
    expect(zoning?.appliedMode).toBe('floors')
    expect(zoning?.fallback?.code).toBe('drawn_zones_missing')
    expect(zoning?.zones).toHaveLength(building.floors ?? 0)
    expect(describeAppliedZoning(zoning!)).toBe(
      'Each floor a zone, falling back from drawn zones',
    )
  })

  test('drawn plans that do not match an edited floor count', () => {
    const building = { ...state.buildings.B0439!, floors: 6 }
    const zoning = zoneBuilding(
      building,
      { mode: 'drawn', perimeterDepthM: 4.5 },
      6,
      state.zoning.drawn.B0439 ?? null,
    )
    expect(zoning?.fallback?.code).toBe('drawn_floors_mismatch')
    expect(zoning?.zones).toHaveLength(6)
  })

  test('as RC-style coded warnings naming the buildings', () => {
    const buildings = ['B0039', 'B0439'].map((id) => state.buildings[id]!)
    const warnings = fallbackWarnings(
      zoningFallbacks(buildings, (building) => ({
        setting: { mode: 'drawn', perimeterDepthM: 4.5 },
        drawn: state.zoning.drawn[building.id] ?? null,
      })),
    )
    expect(warnings).toEqual([
      {
        code: 'drawn_zones_missing',
        buildingIds: ['B0039'],
        message:
          'drawn_zones_missing: 1 building was zoned one zone per floor instead of drawn zones because they have no drawn zones (B0039).',
      },
    ])
  })
})

describe('the zoning.setBuilding command', () => {
  function project() {
    return createWorkbench({
      initialState: buildFixture('partway', NOW),
      now: NOW,
    })
  }

  test('an override outdates Geospatial preprocessing, and a rerun applies it', () => {
    const workbench = project()
    expect(stagesOf(workbench.getState())[STAGE_IDS.preprocessing]).toBe(
      'executed',
    )
    const set = workbench.execute({
      type: 'zoning.setBuilding',
      input: { buildingId: 'B0464', mode: 'perimeterCore' },
    })
    expect(set.outcome).toMatchObject({ status: 'applied' })
    expect(set.outcome.status === 'applied' && set.outcome.summary).toBe(
      'Building 464 (B0464) is zoned by perimeter and core per floor, 4.5 m deep, overriding the project\'s one zone per building. "Geospatial preprocessing" and the stages after it are outdated until it runs again.',
    )
    let state = workbench.getState()
    expect(state.zoning.overrides.B0464).toBe('perimeterCore')
    expect(stagesOf(state)[STAGE_IDS.preprocessing]).toBe('stale')
    expect(buildingZoningChanged(state.zoning, 'B0464')).toBe(true)
    // Zones still follow the last run until it runs again.
    expect(buildingZoning(state, 'B0464')?.zones).toHaveLength(1)

    runStageNow(workbench, STAGE_IDS.preprocessing)
    state = workbench.getState()
    expect(stagesOf(state)[STAGE_IDS.preprocessing]).toBe('executed')
    expect(state.zoning.published?.overrides.B0464).toBe('perimeterCore')
    expect(buildingZoning(state, 'B0464')?.appliedMode).toBe('perimeterCore')
    expect(state.buildings.B0464?.zoneCount).toBe(
      buildingZoning(state, 'B0464')?.zones.length,
    )
    // Other buildings keep the project's mode.
    expect(buildingZoning(state, 'B0039')?.zones).toHaveLength(1)
  })

  test('undo and redo restore the override and the outdated state', () => {
    const workbench = project()
    workbench.execute({
      type: 'zoning.setBuilding',
      input: { buildingId: 'B0464', mode: 'floors' },
    })
    expect(workbench.undo()).toBeTruthy()
    expect(workbench.getState().zoning.overrides.B0464).toBeUndefined()
    expect(stagesOf(workbench.getState())[STAGE_IDS.preprocessing]).toBe(
      'executed',
    )
    workbench.redo()
    expect(workbench.getState().zoning.overrides.B0464).toBe('floors')
  })

  test('drawn zones without outlines say they will fall back', () => {
    const workbench = project()
    const set = workbench.execute({
      type: 'zoning.setBuilding',
      input: { buildingId: 'B0039', mode: 'drawn' },
    })
    expect(set.outcome.status === 'applied' && set.outcome.summary).toContain(
      'this building has no drawn zones. (drawn_zones_missing)',
    )
    runStageNow(workbench, STAGE_IDS.preprocessing)
    const state = workbench.getState()
    expect(buildingZoning(state, 'B0039')?.fallback?.code).toBe(
      'drawn_zones_missing',
    )
    expect(
      state.issues.some((issue) =>
        issue.message.startsWith('drawn_zones_missing: 1 building was zoned'),
      ),
    ).toBe(true)
  })

  test('back to the default, and an override that changes no zone outdates nothing', () => {
    const workbench = project()
    const same = workbench.execute({
      type: 'zoning.setBuilding',
      input: { buildingId: 'B0464', mode: 'single' },
    })
    expect(same.outcome.status === 'applied' && same.outcome.summary).toContain(
      'Its zones are unchanged, so nothing is outdated.',
    )
    expect(stagesOf(workbench.getState())[STAGE_IDS.preprocessing]).toBe(
      'executed',
    )
    const back = workbench.execute({
      type: 'zoning.setBuilding',
      input: { buildingId: 'B0439', mode: 'default' },
    })
    expect(back.outcome.status === 'applied' && back.outcome.summary).toBe(
      'Building 439 (B0439) follows the project\'s zoning again, one zone per building. "Geospatial preprocessing" and the stages after it are outdated until it runs again.',
    )
    expect(resolveBuildingZoning(workbench.getState().zoning, 'B0439')).toEqual(
      { mode: 'single', perimeterDepthM: 4.5, source: 'default' },
    )
  })

  test('refuses an unknown building, an unchanged choice, and a change while preprocessing runs, on their fields', () => {
    const workbench = project()
    const unknown = workbench.execute({
      type: 'zoning.setBuilding',
      input: { buildingId: 'B9999', mode: 'floors' },
    })
    expect(unknown.outcome).toMatchObject({
      status: 'rejected',
      issues: [{ path: 'buildingId' }],
    })
    const unchanged = workbench.execute({
      type: 'zoning.setBuilding',
      input: { buildingId: 'B0439', mode: 'drawn' },
    })
    expect(unchanged.outcome).toMatchObject({
      status: 'rejected',
      issues: [
        {
          path: 'mode',
          message: 'Building 439 (B0439) is already zoned by drawn zones.',
        },
      ],
    })
    const bad = workbench.execute({
      type: 'zoning.setBuilding',
      input: { buildingId: 'B0439', mode: 'courtyard' as 'drawn' },
    })
    expect(bad.outcome).toMatchObject({
      status: 'rejected',
      issues: [{ path: 'mode' }],
    })
    workbench.execute({
      type: 'workflow.runStage',
      input: { stageId: STAGE_IDS.preprocessing },
    })
    const running = workbench.execute({
      type: 'zoning.setBuilding',
      input: { buildingId: 'B0464', mode: 'floors' },
    })
    expect(running.outcome).toMatchObject({
      status: 'rejected',
      issues: [{ path: 'mode' }],
    })
  })
})

describe('saved projects and packages keep per-building zoning', () => {
  test('saves from before overrides and drawn zones open with none', () => {
    const fixture = buildFixture('partway', NOW)
    const saved = JSON.parse(JSON.stringify(fixture)) as {
      zoning: Record<string, unknown> & { published: Record<string, unknown> }
    }
    delete saved.zoning.overrides
    delete saved.zoning.drawn
    delete saved.zoning.published.overrides
    const parsed = projectStateSchema.parse(saved)
    expect(parsed.zoning.overrides).toEqual({})
    expect(parsed.zoning.drawn).toEqual({})
    expect(parsed.zoning.published?.overrides).toEqual({})
    expect(buildingZoning(parsed, 'B0439')?.zones).toHaveLength(1)
  })

  test('overrides, drawn zones, and the published overrides round-trip', () => {
    const fixture = buildFixture('complete', NOW)
    const parsed = projectStateSchema.parse(JSON.parse(JSON.stringify(fixture)))
    expect(parsed.zoning).toEqual(fixture.zoning)
    expect(buildingZoning(parsed, 'B0439')?.zones).toHaveLength(25)
  })

  test('refuses an unknown mode and a plan that ends below its start', () => {
    const fixture = buildFixture('complete', NOW)
    const badMode = JSON.parse(JSON.stringify(fixture)) as WorkbenchState
    ;(badMode.zoning.overrides as Record<string, string>).B0439 = 'courtyard'
    expect(projectStateSchema.safeParse(badMode).success).toBe(false)
    const badPlan = JSON.parse(JSON.stringify(fixture)) as WorkbenchState
    const drawn = badPlan.zoning.drawn.B0439!
    drawn.plans[0] = { ...drawn.plans[0]!, fromFloor: 3, toFloor: 1 }
    expect(projectStateSchema.safeParse(badPlan).success).toBe(false)
  })

  test('the drawn fixture is written for a four-cornered outline', () => {
    const drawn = fixtureDrawnZones()[DRAWN_FIXTURE_BUILDING]
    expect(drawn?.plans.map((each) => [each.fromFloor, each.toFloor])).toEqual([
      [1, 1],
      [2, 3],
      [4, 4],
    ])
    expect(drawn?.source).toContain('Synthetic')
  })
})

describe('review fixes (decision 0034)', () => {
  test('a depth change with the project not zoned by perimeter and core still outdates buildings overridden to it', () => {
    const workbench = createWorkbench({
      initialState: buildFixture('complete', NOW),
      now: NOW,
    })
    expect(workbench.getState().zoning.mode).toBe('single')
    const set = workbench.execute({
      type: 'zoning.set',
      input: { mode: 'single', perimeterDepthM: 2 },
    })
    expect(set.outcome.status === 'applied' && set.outcome.summary).toBe(
      'Perimeter depth set to 2 m. The project\'s zoning, one zone per building, does not use it, but 1 building zoned by perimeter and core of its own do (B0426). "Geospatial preprocessing" and the stages after it are outdated until it runs again.',
    )
    const state = workbench.getState()
    expect(stagesOf(state)[STAGE_IDS.preprocessing]).toBe('stale')
    expect(buildingZoningChanged(state.zoning, 'B0426')).toBe(true)
    // Without such overrides the depth is kept and outdates nothing.
    const plain = createWorkbench({
      initialState: buildFixture('complete', NOW),
      now: NOW,
    })
    plain.execute({
      type: 'zoning.setBuilding',
      input: { buildingId: 'B0426', mode: 'default' },
    })
    runStageNow(plain, STAGE_IDS.preprocessing)
    const kept = plain.execute({
      type: 'zoning.set',
      input: { mode: 'single', perimeterDepthM: 2 },
    })
    expect(kept.outcome.status === 'applied' && kept.outcome.summary).toContain(
      'does not use it, and no building is zoned by perimeter and core of its own.',
    )
    expect(stagesOf(plain.getState())[STAGE_IDS.preprocessing]).toBe('executed')
  })

  test('a plan naming a floor far beyond the building is refused at once, and saves bound it', () => {
    const started = Date.now()
    const far = drawnPlanProblem(FOOTPRINT, [plan(OFFICES, 1, 1e9)], 2)
    expect(Date.now() - started).toBeLessThan(1000)
    expect(far?.message).toContain(
      'describe floors 3 to 1000000000, but the building has 2 floors',
    )
    const fixture = buildFixture('complete', NOW)
    const saved = JSON.parse(JSON.stringify(fixture)) as WorkbenchState
    const drawn = saved.zoning.drawn.B0439!
    drawn.plans[2] = { ...drawn.plans[2]!, toFloor: 501 }
    expect(projectStateSchema.safeParse(saved).success).toBe(false)
    drawn.plans[2] = { ...drawn.plans[2], toFloor: 500 }
    expect(projectStateSchema.safeParse(saved).success).toBe(true)
  })
})
