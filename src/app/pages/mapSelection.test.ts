import { describe, expect, it } from 'vitest'
import type { WorkbenchState } from '../../domain/types.ts'
import { buildFixture } from '../../server/fixtures.ts'
import {
  clickTarget,
  describeTarget,
  stepTarget,
  upTarget,
  type MapHit,
} from './mapSelection.ts'

// Nested selection on the map (decision 0035): building, then floor, then
// zone, with Shift at the same level and Escape and Page Up/Down.

const NOW = () => new Date('2026-10-29T12:00:00Z')
const fixture = buildFixture('complete', NOW)

function at(selection: WorkbenchState['selection']) {
  return { ...fixture, selection }
}
const none = at({ entityType: null, ids: [] })
const building = (id: string) => at({ entityType: 'building', ids: [id] })
const floors = (...ids: string[]) => at({ entityType: 'floor', ids })
const zones = (...ids: string[]) => at({ entityType: 'zone', ids })

/** A hit on a zone cell of B0439 (drawn: floor 2 zones are Z1 core to Z7). */
const cell = (floor: number, zone: number, buildingId = 'B0439'): MapHit => ({
  kind: 'building',
  buildingId,
  floor,
  zoneId: `${buildingId}:F${floor}:Z${zone}`,
})

describe('a click goes down one level at a time', () => {
  it('selects an unselected building, then its floor, then a zone on that floor', () => {
    expect(clickTarget(none, [cell(2, 3)])).toEqual({
      entityType: 'building',
      ids: ['B0439'],
    })
    expect(clickTarget(building('B0439'), [cell(2, 3)])).toEqual({
      entityType: 'floor',
      ids: ['B0439:F2'],
    })
    expect(clickTarget(floors('B0439:F2'), [cell(2, 3)])).toEqual({
      entityType: 'zone',
      ids: ['B0439:F2:Z3'],
    })
    expect(clickTarget(zones('B0439:F2:Z3'), [cell(2, 4)])).toEqual({
      entityType: 'zone',
      ids: ['B0439:F2:Z4'],
    })
  })

  it('chooses another floor of the building from a floor or a zone', () => {
    expect(clickTarget(floors('B0439:F2'), [cell(3, 1)])).toEqual({
      entityType: 'floor',
      ids: ['B0439:F3'],
    })
    expect(clickTarget(zones('B0439:F2:Z3'), [cell(1, 2)])).toEqual({
      entityType: 'floor',
      ids: ['B0439:F1'],
    })
  })

  it('picks the selected floor through a nearer hollow floor in front of it', () => {
    // From above, floor 3 (hollow) is hit first, then floor 2.
    expect(
      clickTarget(floors('B0439:F2'), [cell(4, 1), cell(3, 2), cell(2, 3)]),
    ).toEqual({ entityType: 'zone', ids: ['B0439:F2:Z3'] })
    // Without the selected floor under the pointer, the nearest floor wins.
    expect(clickTarget(floors('B0439:F2'), [cell(4, 1), cell(3, 2)])).toEqual({
      entityType: 'floor',
      ids: ['B0439:F4'],
    })
  })

  it('selects another building whatever is selected', () => {
    for (const state of [
      building('B0439'),
      floors('B0439:F2'),
      zones('B0439:F2:Z3'),
    ]) {
      expect(clickTarget(state, [cell(1, 1, 'B0427')])).toEqual({
        entityType: 'building',
        ids: ['B0427'],
      })
    }
  })

  it('uses the floor a flat map shows for a hit that names none', () => {
    const plain: MapHit = {
      kind: 'building',
      buildingId: 'B0439',
      floor: null,
      zoneId: null,
    }
    expect(clickTarget(building('B0439'), [plain], { planFloor: 1 })).toEqual({
      entityType: 'floor',
      ids: ['B0439:F1'],
    })
    // In 3D without storeys drawn, a click on the selected building changes nothing.
    expect(clickTarget(building('B0439'), [plain])).toBeNull()
  })

  it('clears on an empty spot and selects grid elements as before', () => {
    expect(clickTarget(zones('B0439:F2:Z3'), [])).toBe('clear')
    expect(clickTarget(none, [{ kind: 'grid', id: 'T1' }])).toEqual({
      entityType: 'gridElement',
      ids: ['T1'],
    })
    expect(
      clickTarget(
        at({ entityType: 'gridElement', ids: ['T1'] }),
        [{ kind: 'grid', id: 'T2' }],
        { additive: true },
      ),
    ).toEqual({ entityType: 'gridElement', ids: ['T1', 'T2'] })
  })
})

describe('Shift adds at the same level within the building', () => {
  it('adds and removes floors of the selected building', () => {
    expect(
      clickTarget(floors('B0439:F2'), [cell(3, 1)], { additive: true }),
    ).toEqual({ entityType: 'floor', ids: ['B0439:F2', 'B0439:F3'] })
    expect(
      clickTarget(floors('B0439:F2', 'B0439:F3'), [cell(3, 1)], {
        additive: true,
      }),
    ).toEqual({ entityType: 'floor', ids: ['B0439:F2'] })
  })

  it('adds zones of the selected floor, and goes to a floor elsewhere', () => {
    expect(
      clickTarget(zones('B0439:F2:Z3'), [cell(2, 4)], { additive: true }),
    ).toEqual({ entityType: 'zone', ids: ['B0439:F2:Z3', 'B0439:F2:Z4'] })
    expect(
      clickTarget(zones('B0439:F2:Z3'), [cell(3, 4)], { additive: true }),
    ).toEqual({ entityType: 'floor', ids: ['B0439:F3'] })
  })

  it('selects another building instead of adding across buildings', () => {
    expect(
      clickTarget(floors('B0439:F2'), [cell(1, 1, 'B0427')], {
        additive: true,
      }),
    ).toEqual({ entityType: 'building', ids: ['B0427'] })
    // Buildings themselves still add and remove with Shift.
    expect(
      clickTarget(building('B0439'), [cell(1, 1, 'B0427')], {
        additive: true,
      }),
    ).toEqual({ entityType: 'building', ids: ['B0439', 'B0427'] })
    expect(
      clickTarget(building('B0439'), [cell(1, 1)], { additive: true }),
    ).toBe('clear')
  })
})

describe('the keyboard goes up a level and between floors', () => {
  it('goes up: zone to floor, floor to building, building to nothing', () => {
    expect(upTarget(zones('B0439:F2:Z3'))).toEqual({
      entityType: 'floor',
      ids: ['B0439:F2'],
    })
    expect(upTarget(floors('B0439:F2', 'B0439:F3'))).toEqual({
      entityType: 'building',
      ids: ['B0439'],
    })
    expect(upTarget(building('B0439'))).toBe('clear')
    expect(upTarget(none)).toBeNull()
    // A whole-building zone goes up to its building.
    expect(upTarget(zones('B0464:Z1'))).toEqual({
      entityType: 'building',
      ids: ['B0464'],
    })
  })

  it('steps to the floor above or below, and stops at the ends', () => {
    expect(stepTarget(floors('B0439:F2'), 1)).toEqual({
      entityType: 'floor',
      ids: ['B0439:F3'],
    })
    expect(stepTarget(zones('B0439:F2:Z3'), -1)).toEqual({
      entityType: 'floor',
      ids: ['B0439:F1'],
    })
    expect(stepTarget(floors('B0439:F4'), 1)).toBeNull()
    expect(stepTarget(floors('B0439:F1'), -1)).toBeNull()
    expect(stepTarget(building('B0439'), 1)).toBeNull()
  })
})

describe('hover labels name what a click selects', () => {
  it('names a building, a floor, and a zone', () => {
    const name = (state: typeof none, hits: MapHit[]) =>
      describeTarget(state, clickTarget(state, hits))
    expect(name(none, [cell(2, 3)])).toBe('Building 439')
    expect(name(building('B0439'), [cell(2, 3)])).toBe(
      'Floor 2 of Building 439',
    )
    expect(name(floors('B0439:F2'), [cell(2, 3)])).toBe(
      'Floor 2 apartment southeast, Building 439',
    )
    expect(name(none, [])).toBe('')
  })
})
