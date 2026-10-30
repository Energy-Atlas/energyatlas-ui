import { describe, expect, test } from 'vitest'
import { buildFixture } from '../../server/fixtures.ts'
import { projectStateSchema } from '../../server/projectSchema.ts'
import { commandDefinitions } from '../commands.ts'
import { runStageNow } from '../jobs/runNow.ts'
import type { Building, LngLat, WorkbenchState } from '../types.ts'
import { createWorkbench } from '../workbench.ts'
import { STAGE_IDS, deriveStageStates } from '../workflow.ts'
import {
  FIXTURE_ZONED_BUILDINGS,
  fixtureZoneGeometry,
} from './fixtureGeometry.ts'
import {
  buildingFloors,
  buildingZoning,
  floorExists,
  geometryMismatch,
  selectedBuildingIds,
  zoneBuilding,
  zoneColorSlots,
  zoneExists,
  type ZoneGeometryZone,
} from './zoning.ts'

// Floors and zones (decision 0032, stage 6; decision 0036): zones are the
// backend's geometry, precomputed in the fixture for three buildings and
// displayed only; every other building is one zone.

const NOW = () => new Date('2026-10-28T12:00:00Z')
const stagesOf = (state: WorkbenchState) =>
  deriveStageStates(state.workflow, state.tasks)

const fixture = buildFixture('partway', NOW)

function buildingOf(id: string, state: WorkbenchState = fixture): Building {
  const building = state.buildings[id]
  if (!building) throw new Error(`No building ${id} in the fixture.`)
  return building
}

const open = (ring: LngLat[]) => {
  const first = ring[0]
  const last = ring.at(-1)
  return first && last && first[0] === last[0] && first[1] === last[1]
    ? ring.slice(0, -1)
    : ring
}

/** A local plane in metres around a point, as footprint areas are measured. */
function planeAround(origin: LngLat) {
  const perLng = 111_320 * Math.cos((origin[1] * Math.PI) / 180)
  return ([lng, lat]: LngLat): [number, number] => [
    (lng - origin[0]) * perLng,
    (lat - origin[1]) * 111_320,
  ]
}

function signedArea(ring: [number, number][]): number {
  return (
    ring.reduce((sum, [x1, y1], index) => {
      const [x2, y2] = ring[(index + 1) % ring.length] ?? [x1, y1]
      return sum + x1 * y2 - x2 * y1
    }, 0) / 2
  )
}

/** Distance from p to the segment a–b, and how far along it p falls. */
function onSegment(
  p: [number, number],
  a: [number, number],
  b: [number, number],
): boolean {
  const dx = b[0] - a[0]
  const dy = b[1] - a[1]
  const length2 = dx * dx + dy * dy
  const t = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / length2
  const offset =
    Math.abs((p[0] - a[0]) * dy - (p[1] - a[1]) * dx) / Math.sqrt(length2)
  return t >= -1e-9 && t <= 1 + 1e-9 && offset < 1e-6
}

const key = ([lng, lat]: LngLat) => `${lng},${lat}`

describe('the fixture zone geometry (decision 0036)', () => {
  const geometry = fixtureZoneGeometry()

  test('covers three buildings, each over exactly its fixture storeys', () => {
    expect(Object.keys(geometry).sort()).toEqual(
      [...FIXTURE_ZONED_BUILDINGS].sort(),
    )
    const storeys: Record<string, number> = { B0439: 4, B0427: 9, B0426: 3 }
    for (const id of FIXTURE_ZONED_BUILDINGS) {
      expect(buildingOf(id).floors).toBe(storeys[id])
      const zones = geometry[id]
      if (!zones) throw new Error(`No geometry for ${id}.`)
      expect(geometryMismatch(zones, storeys[id] ?? 0)).toBeNull()
    }
  })

  test('tiles every floor exactly: shared corners, no gaps, no overlaps, on the footprint', () => {
    for (const id of FIXTURE_ZONED_BUILDINGS) {
      const footprint = open(buildingOf(id).footprint)
      const toPlane = planeAround(footprint[0] ?? [0, 0])
      const outline = footprint.map(toPlane)
      const orientation = Math.sign(signedArea(outline))
      const corners = new Set(footprint.map(key))
      for (const plan of geometry[id]?.plans ?? []) {
        // Every directed wall either lies on the footprint's outline or is
        // the reverse of exactly one neighbour's wall: no T-junctions, no
        // gaps, no overlaps.
        const walls = new Map<string, number>()
        for (const zone of plan.zones) {
          const ring = zone.outline
          expect(ring.length).toBeGreaterThanOrEqual(3)
          // Same winding as the footprint, so walls pair up reversed.
          expect(Math.sign(signedArea(ring.map(toPlane)))).toBe(orientation)
          ring.forEach((point, index) => {
            const next = ring[(index + 1) % ring.length] ?? point
            walls.set(`${key(point)}>${key(next)}`, 1)
          })
        }
        let outer = 0
        for (const zone of plan.zones) {
          zone.outline.forEach((point, index) => {
            const next = zone.outline[(index + 1) % zone.outline.length]
            if (!next) return
            const reversed = walls.has(`${key(next)}>${key(point)}`)
            const onOutline = outline.some((a, edge) => {
              const b = outline[(edge + 1) % outline.length] ?? a
              return (
                onSegment(toPlane(point), a, b) &&
                onSegment(toPlane(next), a, b)
              )
            })
            expect(reversed !== onOutline).toBe(true)
            if (onOutline) outer += 1
          })
          // A corner on the footprint's corner is the footprint's own numbers.
          for (const point of zone.outline) {
            const plane = toPlane(point)
            const near = footprint.find((corner) => {
              const [x, y] = toPlane(corner)
              return Math.hypot(x - plane[0], y - plane[1]) < 0.01
            })
            if (near) expect(corners.has(key(point))).toBe(true)
          }
        }
        expect(outer).toBeGreaterThanOrEqual(footprint.length)
        // The zones' areas add up to the footprint's.
        const total = plan.zones.reduce(
          (sum, zone) => sum + Math.abs(signedArea(zone.outline.map(toPlane))),
          0,
        )
        expect(total).toBeCloseTo(Math.abs(signedArea(outline)), 6)
      }
    }
  })
})

describe('zoning a building', () => {
  const geometry = fixtureZoneGeometry()

  test('a building with zone geometry gets its zones on every floor, adding up to the footprint', () => {
    const building = buildingOf('B0426')
    const zoning = zoneBuilding(building, 3, geometry.B0426 ?? null)
    expect(zoning?.source).toBe('geometry')
    expect(zoning?.unused).toBeNull()
    expect(zoning?.zones).toHaveLength(15)
    const floor2 = zoning?.zones.filter((zone) => zone.floor === 2) ?? []
    expect(floor2.map((zone) => zone.id)).toEqual(
      [1, 2, 3, 4, 5].map((index) => `B0426:F2:Z${index}`),
    )
    expect(floor2.map((zone) => zone.name)).toEqual([
      'Floor 2 core',
      'Floor 2 perimeter 1 (north)',
      'Floor 2 perimeter 2 (east)',
      'Floor 2 perimeter 3 (south)',
      'Floor 2 perimeter 4 (west)',
    ])
    expect(floor2[0]?.colorSlot).toBeNull()
    expect(floor2.reduce((sum, zone) => sum + zone.areaM2, 0)).toBeCloseTo(
      building.footprintAreaM2,
      1,
    )
    expect(zoning?.floors[1]?.zoneIds).toHaveLength(5)
    // Each storey spans its floor exactly, so the zones make up the extrusion.
    expect(floor2[0]?.bottomM).toBe(zoning?.floors[1]?.bottomM)
    expect(floor2[0]?.topM).toBe(zoning?.floors[2]?.bottomM)
  })

  test('zones sharing a wall take different colours, and whole floors alternate', () => {
    const drawn = zoneBuilding(buildingOf('B0439'), 4, geometry.B0439 ?? null)
    const plan = geometry.B0439?.plans[1]
    if (!plan || !drawn) throw new Error('No plan.')
    const slots = zoneColorSlots(plan.zones)
    const edges = (zone: ZoneGeometryZone) =>
      new Set(
        zone.outline.map((point, index) => {
          const next = zone.outline[(index + 1) % zone.outline.length] ?? point
          return [key(point), key(next)].sort().join('|')
        }),
      )
    plan.zones.forEach((zone, index) => {
      plan.zones.forEach((other, otherIndex) => {
        if (otherIndex <= index) return
        const shared = [...edges(zone)].some((edge) => edges(other).has(edge))
        const a = slots[index]
        const b = slots[otherIndex]
        if (shared && a !== null && b !== null) expect(a).not.toBe(b)
      })
    })
    expect(drawn.zones.find((zone) => zone.id === 'B0439:F2:Z1')?.use).toBe(
      'core',
    )
    const floors = zoneBuilding(buildingOf('B0427'), 9, geometry.B0427 ?? null)
    expect(floors?.zones.map((zone) => zone.colorSlot).slice(0, 4)).toEqual([
      0, 1, 2, 0,
    ])
    expect(floors?.zones.map((zone) => zone.name).slice(0, 2)).toEqual([
      'Floor 1',
      'Floor 2',
    ])
  })

  test('a building without zone geometry is one zone, as in RC', () => {
    const building = buildingOf('B0039')
    const floors = building.floors ?? 0
    const zoning = zoneBuilding(building, floors, null)
    expect(zoning?.source).toBe('single')
    expect(zoning?.floors).toHaveLength(floors)
    expect(zoning?.floorHeightM).toBeCloseTo((building.heightM ?? 0) / floors)
    expect(zoning?.zones).toEqual([
      expect.objectContaining({
        id: 'B0039:Z1',
        kind: 'building',
        areaM2: Math.round(building.footprintAreaM2 * floors * 100) / 100,
      }),
    ])
    expect(zoning?.floors[0]?.zoneIds).toEqual(['B0039:Z1'])
    // No height yet: no floors or zones.
    expect(zoneBuilding({ ...building, heightM: null }, floors)).toBeNull()
  })

  test('zone geometry that does not cover the floors is not shown, and says why', () => {
    const zoning = zoneBuilding(buildingOf('B0439'), 5, geometry.B0439 ?? null)
    expect(zoning?.source).toBe('single')
    expect(zoning?.unused).toBe(
      'its zone geometry has no single plan for floor 5',
    )
    expect(zoning?.zones).toHaveLength(1)
    expect(
      geometryMismatch(geometry.B0439 ?? { source: '', plans: [] }, 3),
    ).toBe('its zone geometry names floors above its 3')
  })
})

function preprocessed(): ReturnType<typeof createWorkbench> {
  return createWorkbench({
    initialState: buildFixture('partway', NOW),
    now: NOW,
  })
}

describe('preprocessing and the fixtures', () => {
  test('publishes the zone geometry as zones: 510 zones in the complete fixture', () => {
    const complete = buildFixture('complete', NOW)
    const counts = Object.fromEntries(
      FIXTURE_ZONED_BUILDINGS.map((id) => [
        id,
        buildingZoning(complete, id)?.zones.length,
      ]),
    )
    expect(counts).toEqual({ B0439: 25, B0427: 9, B0426: 15 })
    expect(
      FIXTURE_ZONED_BUILDINGS.map((id) => complete.buildings[id]?.zoneCount),
    ).toEqual([25, 9, 15])
    const total = complete.buildingIds.reduce(
      (sum, id) => sum + (complete.buildings[id]?.zoneCount ?? 0),
      0,
    )
    expect(total).toBe(510)
    expect(complete.assets['asset:zones']?.summary).toBe(
      '510 zones, 3 buildings zoned by their zone geometry, the rest one zone each',
    )
    // The New fixture stores the geometry; nothing is zoned yet.
    const fresh = buildFixture('new', NOW)
    expect(Object.keys(fresh.zoning.geometry).sort()).toEqual(
      [...FIXTURE_ZONED_BUILDINGS].sort(),
    )
    expect(buildingZoning(fresh, 'B0439')).toBeNull()
  })

  test('has no zoning command: the browser never zones a building', () => {
    expect(Object.keys(commandDefinitions)).not.toContain('zoning.set')
    expect(Object.keys(commandDefinitions)).not.toContain('zoning.setBuilding')
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
        input: { entityType: 'zone', ids: ['B0439:F2:Z2'] },
      }).outcome,
    ).toMatchObject({
      status: 'applied',
      summary: `Selected zone Floor 2 corridor of ${zoned.buildings.B0439?.name}.`,
    })
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
    expect(zoneExists(state, 'B0426:F3:Z5')).toBe(true)
  })
})

describe('saved projects and packages', () => {
  test('from before zoning load with no zone geometry and no published zoning', () => {
    const saved = JSON.parse(JSON.stringify(fixture)) as Record<string, unknown>
    delete saved.zoning
    const parsed = projectStateSchema.parse(saved)
    expect(parsed.zoning).toEqual({ geometry: {}, published: null })
    // Floors still follow storeys and heights; zones wait for a rerun.
    expect(buildingZoning(parsed, 'B0039')).toBeNull()
    expect(floorExists(parsed, 'B0039:F1')).toBe(true)
    // Building totals and zone counts saved before stay as they were.
    expect(parsed.buildings).toEqual(fixture.buildings)
  })

  test('with the zoning settings decision 0036 removed still open, without them', () => {
    const saved = JSON.parse(JSON.stringify(fixture)) as {
      zoning: Record<string, unknown>
    }
    const published = saved.zoning.published as Record<string, unknown>
    saved.zoning = {
      mode: 'perimeterCore',
      perimeterDepthM: 4.5,
      overrides: { B0439: 'drawn', B0427: 'floors' },
      drawn: {
        B0439: {
          source: 'Synthetic floor plan',
          plans: [
            {
              fromFloor: 1,
              toFloor: 4,
              zones: [{ name: 'lobby', use: 'lobby', outline: [[0, 0]] }],
            },
          ],
        },
      },
      published: {
        ...published,
        mode: 'perimeterCore',
        perimeterDepthM: 4.5,
        overrides: { B0439: 'drawn' },
      },
    }
    const parsed = projectStateSchema.parse(saved)
    expect(parsed.zoning).toEqual({
      geometry: {},
      published: {
        runId: fixture.zoning.published?.runId,
        storeys: fixture.zoning.published?.storeys,
      },
    })
    // Without geometry every building is one zone.
    expect(buildingZoning(parsed, 'B0439')?.zones).toHaveLength(1)
  })

  test('round-trip the zone geometry and the published run', () => {
    const state = preprocessed().getState()
    const parsed = projectStateSchema.parse(JSON.parse(JSON.stringify(state)))
    expect(parsed.zoning).toEqual(state.zoning)
    expect(buildingZoning(parsed, 'B0439')?.zones).toHaveLength(25)
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
