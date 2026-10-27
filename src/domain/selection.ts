import { ARCHETYPE_LIBRARY, SCHEDULE_LIBRARY } from './archetypes/library.ts'
import { MEASURE_LIBRARY } from './scenarios/library.ts'
import type { SelectableEntity, WorkbenchState } from './types.ts'

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

/** Where each selectable kind lives: a state collection or a library. */
export function selectableCollection(
  state: Pick<
    WorkbenchState,
    | 'buildings'
    | 'gridElements'
    | 'archetypes'
    | 'schedules'
    | 'measures'
    | 'scenarios'
    | 'assets'
    | 'workflow'
  >,
  entityType: SelectableEntity,
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
  }
}
