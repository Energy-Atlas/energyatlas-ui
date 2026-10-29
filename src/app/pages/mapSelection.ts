import type { WorkbenchState } from '../../domain/types.ts'
import {
  buildingFloors,
  buildingZoning,
  ownerOf,
} from '../../domain/zoning/zoning.ts'
import { floorNumberOf } from './zoneFeatures.ts'

// Nested selection on the map (decision 0035). A click on an unselected
// building selects the building; only once a building is selected does a
// click on it select the floor under the pointer, and only once a floor is
// selected does a click on that floor select the zone under the pointer. A
// click on another building selects that building. Shift adds at the same
// level within the same building. Escape goes up one level, and Page Up and
// Page Down move a selected floor or zone to the floor above or below. The
// Table, Assets, Properties, and the agent select floors and zones directly.

type Project = Pick<WorkbenchState, 'selection' | 'buildings' | 'zoning'>

/** What a click or hover found on the map, nearest first. */
export type MapHit =
  | {
      kind: 'building'
      buildingId: string
      /** The storey hit, when the map draws storeys (slabs or zone cells). */
      floor: number | null
      /** The zone hit, when the map draws the building's zones. */
      zoneId: string | null
    }
  | { kind: 'grid'; id: string }

/** A new selection, `clear` for none, or null when nothing changes. */
export type MapTarget =
  | { entityType: 'building' | 'floor' | 'zone' | 'gridElement'; ids: string[] }
  | 'clear'
  | null

const floorId = (buildingId: string, floor: number) => `${buildingId}:F${floor}`

/** The floor numbers a building has, as the last run sliced them. */
function floorsOf(state: Project, buildingId: string): number[] {
  return buildingFloors(state, buildingId).map((floor) => floor.number)
}

/** The floor a zone is on; null for a whole-building zone. */
function zoneFloor(state: Project, zoneId: string): number | null | undefined {
  return buildingZoning(state, ownerOf(zoneId))?.zones.find(
    (zone) => zone.id === zoneId,
  )?.floor
}

/**
 * The floors of a building the selection is on: selected floors, or the
 * floors of selected zones (every floor for a whole-building zone).
 */
function selectedFloors(state: Project, buildingId: string): Set<number> {
  const { selection } = state
  const floors = new Set<number>()
  for (const id of selection.ids) {
    if (ownerOf(id) !== buildingId) continue
    if (selection.entityType === 'floor') {
      const number = floorNumberOf(id)
      if (number !== null) floors.add(number)
    } else if (selection.entityType === 'zone') {
      const floor = zoneFloor(state, id)
      if (floor === null) {
        for (const each of floorsOf(state, buildingId)) floors.add(each)
      } else if (floor !== undefined) floors.add(floor)
    }
  }
  return floors
}

const toggle = (ids: string[], id: string) =>
  ids.includes(id) ? ids.filter((each) => each !== id) : [...ids, id]

/**
 * The building of the selected floors or zones, when they are all in one
 * building; otherwise null.
 */
function focusBuilding(state: Project): string | null {
  const { selection } = state
  if (selection.entityType !== 'floor' && selection.entityType !== 'zone') {
    return null
  }
  const owners = new Set(selection.ids.map(ownerOf))
  return owners.size === 1 ? ([...owners][0] ?? null) : null
}

/**
 * What a click on the map selects, given what is selected now and what the
 * click hit, nearest first. On a building whose floor or zone is selected,
 * a hit on a selected floor wins over nearer hollow floors in front of it, so
 * its zones can be picked through them. `planFloor` is the floor a flat map
 * shows, for hits that name no storey.
 */
export function clickTarget(
  state: Project,
  hits: MapHit[],
  options: { additive?: boolean; planFloor?: number | null } = {},
): MapTarget {
  const additive = options.additive ?? false
  const { selection } = state
  const focus = focusBuilding(state)
  const focusFloors = focus ? selectedFloors(state, focus) : new Set<number>()
  const hit =
    hits.find(
      (each) =>
        each.kind === 'building' &&
        each.buildingId === focus &&
        each.floor !== null &&
        focusFloors.has(each.floor),
    ) ?? hits[0]
  if (!hit) return 'clear'
  if (hit.kind === 'grid') {
    return {
      entityType: 'gridElement',
      ids:
        additive && selection.entityType === 'gridElement'
          ? toggle(selection.ids, hit.id)
          : [hit.id],
    }
  }
  const { buildingId } = hit
  const floors = floorsOf(state, buildingId)
  const floor = hit.floor ?? options.planFloor ?? null
  const hasFloor = floor !== null && floors.includes(floor)

  // A building selected: a click on it goes down to the floor.
  if (
    selection.entityType === 'building' &&
    selection.ids.includes(buildingId)
  ) {
    if (additive) {
      const ids = toggle(selection.ids, buildingId)
      return ids.length > 0 ? { entityType: 'building', ids } : 'clear'
    }
    return hasFloor
      ? { entityType: 'floor', ids: [floorId(buildingId, floor)] }
      : null
  }

  // A floor or zone of this building selected.
  if (focus === buildingId && hasFloor) {
    const onSelected = focusFloors.has(floor)
    if (selection.entityType === 'floor') {
      if (additive) {
        const ids = toggle(selection.ids, floorId(buildingId, floor))
        return ids.length > 0 ? { entityType: 'floor', ids } : null
      }
      if (onSelected && hit.zoneId) {
        return { entityType: 'zone', ids: [hit.zoneId] }
      }
      return { entityType: 'floor', ids: [floorId(buildingId, floor)] }
    }
    // Zones selected.
    if (onSelected && hit.zoneId) {
      if (additive) {
        const ids = toggle(selection.ids, hit.zoneId)
        return ids.length > 0 ? { entityType: 'zone', ids } : null
      }
      return { entityType: 'zone', ids: [hit.zoneId] }
    }
    // Another floor: choose it, whatever the Shift key.
    return { entityType: 'floor', ids: [floorId(buildingId, floor)] }
  }

  // Any other building: select it (Shift adds buildings).
  if (additive && selection.entityType === 'building') {
    return { entityType: 'building', ids: toggle(selection.ids, buildingId) }
  }
  return { entityType: 'building', ids: [buildingId] }
}

/** Escape on the map: zone to its floor, floor to its building, building to nothing. */
export function upTarget(state: Project): MapTarget {
  const { selection } = state
  if (selection.ids.length === 0 || selection.entityType === null) return null
  if (selection.entityType === 'zone') {
    const floors = new Set<string>()
    const buildings = new Set<string>()
    for (const id of selection.ids) {
      const floor = zoneFloor(state, id)
      if (typeof floor === 'number') floors.add(floorId(ownerOf(id), floor))
      else buildings.add(ownerOf(id))
    }
    return floors.size > 0
      ? { entityType: 'floor', ids: [...floors] }
      : { entityType: 'building', ids: [...buildings] }
  }
  if (selection.entityType === 'floor') {
    return {
      entityType: 'building',
      ids: [...new Set(selection.ids.map(ownerOf))],
    }
  }
  if (
    selection.entityType === 'building' ||
    selection.entityType === 'gridElement'
  ) {
    return 'clear'
  }
  return null
}

/**
 * Page Up and Page Down on the map: the floor above or below the selected
 * floor or zone (the first one), or null at the top or bottom.
 */
export function stepTarget(state: Project, delta: 1 | -1): MapTarget {
  const { selection } = state
  const first = selection.ids[0]
  if (!first) return null
  let current: number | null = null
  if (selection.entityType === 'floor') current = floorNumberOf(first)
  else if (selection.entityType === 'zone') {
    current = zoneFloor(state, first) ?? null
  }
  if (current === null) return null
  const buildingId = ownerOf(first)
  const next = current + delta
  return floorsOf(state, buildingId).includes(next)
    ? { entityType: 'floor', ids: [floorId(buildingId, next)] }
    : null
}

/** What a target names, for the map's hover label. */
export function describeTarget(state: Project, target: MapTarget): string {
  if (target === null || target === 'clear') return ''
  const id = target.ids[0] ?? ''
  const more = target.ids.length > 1 ? ` and ${target.ids.length - 1} more` : ''
  if (target.entityType === 'floor') {
    const owner = ownerOf(id)
    return `Floor ${floorNumberOf(id) ?? ''} of ${state.buildings[owner]?.name ?? owner}${more}`
  }
  if (target.entityType === 'zone') {
    const owner = ownerOf(id)
    const zone = buildingZoning(state, owner)?.zones.find(
      (each) => each.id === id,
    )
    return `${zone?.name ?? id}, ${state.buildings[owner]?.name ?? owner}${more}`
  }
  if (target.entityType === 'building') {
    return `${state.buildings[id]?.name ?? id}${more}`
  }
  return `${id}${more}`
}
