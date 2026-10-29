import type { WorkbenchState } from '../../domain/types.ts'
import type { Workbench } from '../../domain/workbench.ts'
import { buildingZoning } from '../../domain/zoning/zoning.ts'
import type { LayoutController } from '../layout/layoutController.ts'
import type { ViewStore } from '../view/viewStore.ts'
import { zonesLayer, type MapLayer } from './mapLayers.ts'

// "Show zones in 3D" (decision 0034): zones are drawn in 3D for selected
// buildings only, so this selects the buildings, turns the 3D view on, opens
// the Map, and frames them, through the same command, view operations, and
// layout path the agent uses (selection.set, map.set3d, layout.openPage,
// map.focusSelection).

/** Why the buildings' zones cannot be shown in 3D, or null when they can. */
export function zones3dBlocker(
  state: Pick<WorkbenchState, 'buildings' | 'zoning'>,
  layers: MapLayer[],
  buildingIds: string[],
): string | null {
  if (buildingIds.length === 0) {
    return 'Select a building first, on the Map or the Table page.'
  }
  if (!buildingIds.some((id) => buildingZoning(state, id) !== null)) {
    return buildingIds.length === 1
      ? 'This building has no zones yet: "Geospatial preprocessing" has not zoned it.'
      : 'None of the selected buildings has zones yet: "Geospatial preprocessing" has not zoned them.'
  }
  if (!zonesLayer(layers)) {
    return 'No shown building layer extrudes in 3D: show a building layer and turn on “Extrude to height” in the map’s Properties.'
  }
  return null
}

export function showZonesIn3d(
  services: { workbench: Workbench; view: ViewStore; layout: LayoutController },
  buildingIds: string[],
): void {
  const { workbench, view, layout } = services
  // The whole selection is kept; the map draws zones for the first
  // MAX_ZONED_BUILDINGS and the zoom's message and the legend count the rest.
  const ids = buildingIds
  const selection = workbench.getState().selection
  const same =
    selection.entityType === 'building' &&
    selection.ids.length === ids.length &&
    ids.every((id) => selection.ids.includes(id))
  if (!same) {
    workbench.execute({
      type: 'selection.set',
      input: { entityType: 'building', ids },
    })
  }
  if (!view.getState().map.view3d) {
    view.execute({ type: 'map.set3d', input: { enabled: true } })
  }
  layout.openPage('map')
  view.execute({ type: 'map.focusSelection', input: {} })
}
