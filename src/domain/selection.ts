import { ARCHETYPE_LIBRARY, SCHEDULE_LIBRARY } from './archetypes/library.ts'
import { MEASURE_LIBRARY } from './scenarios/library.ts'
import type { SelectableEntity, WorkbenchState } from './types.ts'
import { floorExists, zoneExists } from './zoning/zoning.ts'

// The synthetic libraries by the id the selection uses for each entry.
const LIBRARY_ARCHETYPES = Object.fromEntries(
  ARCHETYPE_LIBRARY.map((entry) => [entry.id, entry]),
)
const LIBRARY_SCHEDULES = Object.fromEntries(
  SCHEDULE_LIBRARY.map((entry) => [entry.id, entry]),
)
const LIBRARY_MEASURES = Object.fromEntries(
  MEASURE_LIBRARY.map((entry) => [entry.libraryId, entry]),
)

type SelectableState = Pick<
  WorkbenchState,
  | 'buildings'
  | 'gridElements'
  | 'archetypes'
  | 'parts'
  | 'rules'
  | 'schedules'
  | 'measures'
  | 'scenarios'
  | 'scenarioRules'
  | 'assets'
  | 'workflow'
  | 'zoning'
>

/**
 * Where each stored selectable kind lives: a state collection or a library.
 * Floors and zones are derived (decision 0032, stage 6), so they have none;
 * use `selectableExists` for every kind.
 */
export function selectableCollection(
  state: SelectableState,
  entityType: Exclude<SelectableEntity, 'floor' | 'zone'>,
): Record<string, unknown> {
  switch (entityType) {
    case 'building':
      return state.buildings
    case 'gridElement':
      return state.gridElements
    case 'archetype':
      return state.archetypes
    case 'schedule':
      return state.schedules
    case 'measure':
      return state.measures
    case 'scenario':
      return state.scenarios
    case 'asset':
      return state.assets
    case 'stage':
      return state.workflow.stages
    case 'libraryArchetype':
      return LIBRARY_ARCHETYPES
    case 'librarySchedule':
      return LIBRARY_SCHEDULES
    case 'libraryMeasure':
      return LIBRARY_MEASURES
    case 'archetypePart':
      return state.parts
    case 'assignmentRule':
      return state.rules
    case 'scenarioRule':
      return state.scenarioRules
  }
}

/** Whether the selection can hold this id: a stored entity, or a derived floor or zone. */
export function selectableExists(
  state: SelectableState,
  entityType: SelectableEntity,
  id: string,
): boolean {
  if (entityType === 'floor') return floorExists(state, id)
  if (entityType === 'zone') return zoneExists(state, id)
  return id in selectableCollection(state, entityType)
}
