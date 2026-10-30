import { useMemo } from 'react'
import type { WorkbenchState } from '../../domain/types.ts'
import { STAGE_IDS } from '../../domain/workflow.ts'
import {
  buildingFloors,
  buildingZoning,
  describeBuildingZoning,
  selectedBuildingIds,
  zoneTypeLabel,
  type Floor,
  type Zone,
} from '../../domain/zoning/zoning.ts'
import {
  useServices,
  useStageStates,
  useWorkbenchSnapshot,
} from '../WorkbenchContext.tsx'
import { ActionButton } from '../components/ActionButton.tsx'
import { CapabilityBadge } from '../components/CapabilityBadge.tsx'
import { InlineAlert } from '../components/InlineAlert.tsx'
import { WorkbenchTable } from '../components/WorkbenchTable.tsx'
import componentStyles from '../components/components.module.css'
import type { DataColumn } from '../tables/tableModel.ts'
import styles from './properties.module.css'

// A building's floors and zones in Properties (decision 0032, stage 6): two
// shared tables whose rows select a floor or zone, which the Map and the
// Table page show too. Zones are the backend's geometry and display only
// (decision 0036): nothing here zones a building.

type FloorRow = Floor & { zones: number }

const ZONE_PAGE = 50

/** What Properties says about a building's zones, worst first; empty when all is well. */
export function zoningNotes(
  state: WorkbenchState,
  buildingId: string,
  preprocessingState: string | undefined,
): string[] {
  const building = state.buildings[buildingId]
  if (!building || building.heightM === null) return []
  if (!state.zoning.published) {
    return [
      `Zones appear once "Geospatial preprocessing" runs again${building.zoneCount === null ? '' : ` (${building.zoneCount} counted before zones were shown)`}.`,
    ]
  }
  const notes: string[] = []
  const unused = buildingZoning(state, buildingId)?.unused
  if (unused) {
    notes.push(
      `The backend's zone geometry is not shown because ${unused}: the building is shown as one zone until "Geospatial preprocessing" zones it again.`,
    )
  }
  if (preprocessingState === 'stale') {
    notes.push(
      '"Geospatial preprocessing" is outdated: floors and zones follow its last run until it runs again.',
    )
  }
  return notes
}

/**
 * Geospatial preprocessing's Properties: where zones come from (decision
 * 0036). There is no zoning setting; the backend zones buildings.
 */
export function ZoneGeometryNote() {
  const state = useWorkbenchSnapshot((snapshot) => snapshot.state)
  const stored = Object.keys(state.zoning.geometry).filter(
    (id) => state.buildings[id],
  )
  return (
    <p className={componentStyles.muted} data-testid="zone-geometry-note">
      Zoning is done by the backend: the browser shows the zone geometry it
      delivers and never zones a building itself.{' '}
      {stored.length > 0
        ? `${stored.length} building${stored.length === 1 ? ' has' : 's have'} zone geometry (${stored.slice(0, 5).join(', ')}); every other building is one zone, as in RC.`
        : 'No building has zone geometry, so every building is one zone, as in RC.'}{' '}
      <CapabilityBadge id="zoning.zoneGeometry" />
    </p>
  )
}

export function FloorsAndZones({ buildingId }: { buildingId: string }) {
  const { workbench, view, layout } = useServices()
  const state = useWorkbenchSnapshot((snapshot) => snapshot.state)
  const stageStates = useStageStates()
  const building = state.buildings[buildingId]
  const zoning = buildingZoning(state, buildingId)
  const floors = buildingFloors(state, buildingId)
  const { selection } = state

  const floorRows = useMemo<FloorRow[]>(
    () => floors.map((floor) => ({ ...floor, zones: floor.zoneIds.length })),
    [floors],
  )
  const zoneRows = zoning?.zones ?? []
  const floorColumns = useMemo<DataColumn<FloorRow>[]>(
    () => [
      {
        id: 'floor',
        header: 'Floor',
        value: (row) => row.number,
        type: 'number',
        rowHeader: true,
      },
      {
        id: 'bottomM',
        header: 'From',
        unit: 'm',
        value: (row) => row.bottomM,
        type: 'number',
        decimals: 1,
      },
      {
        id: 'topM',
        header: 'To',
        unit: 'm',
        value: (row) => row.topM,
        type: 'number',
        decimals: 1,
      },
      {
        id: 'areaM2',
        header: 'Area',
        unit: 'm²',
        value: (row) => row.areaM2,
        type: 'number',
      },
      {
        id: 'zones',
        header: 'Zones',
        value: (row) => row.zones,
        type: 'number',
      },
    ],
    [],
  )
  const zoneColumns = useMemo<DataColumn<Zone>[]>(
    () => [
      {
        id: 'name',
        header: 'Zone',
        value: (row) => row.name,
        rowHeader: true,
      },
      {
        id: 'kind',
        header: 'Type',
        value: (row) => zoneTypeLabel(row),
        type: 'enum',
      },
      {
        id: 'floor',
        header: 'Floor',
        value: (row) => row.floor,
        type: 'number',
        empty: 'All',
      },
      {
        id: 'areaM2',
        header: 'Area',
        unit: 'm²',
        value: (row) => row.areaM2,
        type: 'number',
      },
      {
        id: 'bottomM',
        header: 'From',
        unit: 'm',
        value: (row) => row.bottomM,
        type: 'number',
        decimals: 1,
      },
      {
        id: 'topM',
        header: 'To',
        unit: 'm',
        value: (row) => row.topM,
        type: 'number',
        decimals: 1,
      },
      {
        id: 'id',
        header: 'ID',
        value: (row) => row.id,
        type: 'identifier',
      },
    ],
    [],
  )

  if (!building) return null
  const select = (entityType: 'floor' | 'zone') => (id: string) =>
    workbench.execute({
      type: 'selection.set',
      input: { entityType, ids: [id] },
    })
  const showInTable = (tableView: 'floors' | 'zones') => {
    view.execute({ type: 'table.setView', input: { view: tableView } })
    layout.openPage('table')
  }
  // The Map draws the selected building's zones; this brings it into view.
  const showOnMap = () => {
    if (selectedBuildingIds(selection).length === 0) {
      workbench.execute({
        type: 'selection.set',
        input: { entityType: 'building', ids: [buildingId] },
      })
    }
    layout.openPage('map')
    view.execute({ type: 'map.focusSelection', input: {} })
  }
  const geometry = state.zoning.geometry[buildingId]
  const notes = zoningNotes(
    state,
    buildingId,
    stageStates[STAGE_IDS.preprocessing],
  )
  const selectedFloor =
    selection.entityType === 'floor' ? (selection.ids[0] ?? null) : null
  const selectedZone =
    selection.entityType === 'zone' ? (selection.ids[0] ?? null) : null

  if (floors.length === 0) {
    return (
      <div className={styles.floorsZones} data-testid="floors-and-zones">
        <p className={componentStyles.muted}>
          Floors and zones appear once &ldquo;Geospatial preprocessing&rdquo;
          has computed this building&rsquo;s height
          {building.floors === null ? ' from its floor count' : ''}.
        </p>
      </div>
    )
  }

  return (
    <div className={styles.floorsZones} data-testid="floors-and-zones">
      <p className={componentStyles.muted}>
        {zoning
          ? `${floors.length} floor${floors.length === 1 ? '' : 's'} of ${zoning.floorHeightM.toLocaleString('en-US')} m (height over storeys); ${zoning.zones.length} zone${zoning.zones.length === 1 ? '' : 's'}, ${describeBuildingZoning(zoning)}, ${zoning.source === 'geometry' ? "from the backend's zone geometry" : 'with no zone geometry from the backend'}. Zones are display only.`
          : `${floors.length} floor${floors.length === 1 ? '' : 's'} (height over storeys).`}{' '}
        <CapabilityBadge id="zoning.floorsZones" />
      </p>
      {geometry && zoning?.source === 'geometry' ? (
        <p className={componentStyles.muted}>
          Zone geometry: {geometry.source}.{' '}
          <CapabilityBadge id="zoning.zoneGeometry" />
        </p>
      ) : null}
      <div className={styles.actions}>
        <ActionButton
          label={`Show ${building.name} and its zones on the Map`}
          disabledReason={null}
          onPress={showOnMap}
        >
          Show on Map
        </ActionButton>
      </div>
      {notes.map((note) => (
        <InlineAlert key={note} tone="warning">
          {note}
        </InlineAlert>
      ))}
      <WorkbenchTable
        id="properties.floors"
        aria-label={`Floors of ${building.name}`}
        columns={floorColumns}
        rows={floorRows}
        rowKey={(row) => row.id}
        selection={{
          selectedKey: selectedFloor,
          onSelect: select('floor'),
        }}
        barStart={
          <ActionButton
            label="Show every floor in the Table"
            disabledReason={null}
            onPress={() => showInTable('floors')}
          >
            Floors in Table
          </ActionButton>
        }
        exportContext={[`building: ${building.id}`]}
      />
      {zoning ? (
        <WorkbenchTable
          id="properties.zones"
          aria-label={`Zones of ${building.name}`}
          columns={zoneColumns}
          rows={zoneRows}
          rowKey={(row) => row.id}
          pageSize={ZONE_PAGE}
          currentKey={selectedZone}
          selection={{
            selectedKey: selectedZone,
            onSelect: select('zone'),
          }}
          barStart={
            <ActionButton
              label="Show every zone in the Table"
              disabledReason={null}
              onPress={() => showInTable('zones')}
            >
              Zones in Table
            </ActionButton>
          }
          exportContext={[
            `building: ${building.id}`,
            `zoning: ${describeBuildingZoning(zoning)}`,
          ]}
        />
      ) : null}
    </div>
  )
}
