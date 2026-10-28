import { useMemo } from 'react'
import type { WorkbenchState } from '../../domain/types.ts'
import { STAGE_IDS } from '../../domain/workflow.ts'
import {
  ZONE_KIND_LABELS,
  buildingFloors,
  buildingZoning,
  demandShares,
  describeZoning,
  sameZoning,
  selectedBuildingIds,
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
// Table page show too. Zones are display only.

type FloorRow = Floor & { zones: number; demandKwh: number | null }
type ZoneRow = Zone & { demandKwh: number | null }

const ZONE_PAGE = 50

/** What Properties says about a building's zoning, worst first; empty when all is well. */
export function zoningNotes(
  state: WorkbenchState,
  buildingId: string,
  preprocessingState: string | undefined,
): string[] {
  const building = state.buildings[buildingId]
  if (!building || building.heightM === null) return []
  const notes: string[] = []
  const published = state.zoning.published
  if (!published) {
    notes.push(
      `Zones were counted before the zoning setting existed${building.zoneCount === null ? '' : ` (${building.zoneCount}, estimated from floor area)`}. Run "Geospatial preprocessing" again to zone this building by the setting.`,
    )
  } else {
    const fallback = buildingZoning(state, buildingId)?.fallback
    if (fallback) notes.push(`${fallback.message} (${fallback.code})`)
    if (!sameZoning(published, state.zoning)) {
      notes.push(
        `The zoning setting is now ${describeZoning(state.zoning).toLowerCase()}; "Geospatial preprocessing" has not applied it yet.`,
      )
    } else if (preprocessingState === 'stale') {
      notes.push(
        '"Geospatial preprocessing" is outdated: floors and zones follow its last run until it runs again.',
      )
    }
  }
  return notes
}

export function FloorsAndZones({ buildingId }: { buildingId: string }) {
  const { workbench, view, layout } = useServices()
  const state = useWorkbenchSnapshot((snapshot) => snapshot.state)
  const stageStates = useStageStates()
  const building = state.buildings[buildingId]
  const zoning = buildingZoning(state, buildingId)
  const floors = buildingFloors(state, buildingId)
  const baselineKwh = state.results.baseline?.byBuildingKwh[buildingId]
  const shares = useMemo(
    () =>
      zoning && baselineKwh !== undefined
        ? demandShares(zoning, baselineKwh)
        : null,
    [zoning, baselineKwh],
  )
  const { selection } = state

  const floorRows = useMemo<FloorRow[]>(
    () =>
      floors.map((floor) => ({
        ...floor,
        zones: floor.zoneIds.length,
        demandKwh: shares?.floors[floor.id] ?? null,
      })),
    [floors, shares],
  )
  const zoneRows = useMemo<ZoneRow[]>(
    () =>
      (zoning?.zones ?? []).map((zone) => ({
        ...zone,
        demandKwh: shares?.zones[zone.id] ?? null,
      })),
    [zoning, shares],
  )
  const withDemand = shares !== null
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
      ...(withDemand
        ? [
            {
              id: 'demandKwh',
              header: 'Baseline share',
              unit: 'kWh/yr',
              value: (row: FloorRow) => row.demandKwh,
              type: 'number' as const,
            },
          ]
        : []),
    ],
    [withDemand],
  )
  const zoneColumns = useMemo<DataColumn<ZoneRow>[]>(
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
        value: (row) => ZONE_KIND_LABELS[row.kind],
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
      ...(withDemand
        ? [
            {
              id: 'demandKwh',
              header: 'Baseline share',
              unit: 'kWh/yr',
              value: (row: ZoneRow) => row.demandKwh,
              type: 'number' as const,
            },
          ]
        : []),
    ],
    [withDemand],
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
      <p className={componentStyles.muted}>
        Floors and zones appear once &ldquo;Geospatial preprocessing&rdquo; has
        computed this building&rsquo;s height
        {building.floors === null ? ' from its floor count' : ''}.
      </p>
    )
  }

  return (
    <div className={styles.floorsZones} data-testid="floors-and-zones">
      <p className={componentStyles.muted}>
        {zoning
          ? `${floors.length} floor${floors.length === 1 ? '' : 's'} of ${zoning.floorHeightM.toLocaleString('en-US')} m (height over storeys); ${zoning.zones.length} zone${zoning.zones.length === 1 ? '' : 's'}, ${describeZoning({ mode: zoning.appliedMode, perimeterDepthM: zoning.setting.perimeterDepthM }).toLowerCase()}, as the last Geospatial preprocessing run zoned it. Zones are display only.`
          : `${floors.length} floor${floors.length === 1 ? '' : 's'} (height over storeys).`}{' '}
        <CapabilityBadge id="zoning.floorsZones" />
      </p>
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
            `zoning: ${describeZoning(zoning.setting)}`,
          ]}
        />
      ) : null}
      {withDemand ? (
        <p className={componentStyles.muted}>
          Baseline share: the building&rsquo;s published baseline split by floor
          area in whole kWh, so floors and zones each add up to its total; no
          zone is simulated on its own.{' '}
          <CapabilityBadge id="results.zoneBreakdown" />
        </p>
      ) : null}
    </div>
  )
}
