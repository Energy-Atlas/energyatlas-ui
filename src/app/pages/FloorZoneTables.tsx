import type { GridApi } from 'ag-grid-community'
import { useMemo, useRef, useState } from 'react'
import type { Building } from '../../domain/types.ts'
import { STAGE_IDS } from '../../domain/workflow.ts'
import {
  ZONING_SOURCE_LABELS,
  buildingFloors,
  buildingZoning,
  describeAppliedZoning,
  describeZoning,
  publishedZoningOf,
  zoneTypeLabel,
  type Floor,
  type PublishedZoning,
  type Zone,
} from '../../domain/zoning/zoning.ts'
import { useWorkbenchSnapshot } from '../WorkbenchContext.tsx'
import { EmptyState } from '../components/EmptyState.tsx'
import { GridTable } from '../components/GridTable.tsx'
import { useWorkbenchTable } from '../components/useWorkbenchTable.ts'
import type { DataColumn } from '../tables/tableModel.ts'
import styles from './table.module.css'
import {
  ROW_SELECTION,
  useSelectionHandler,
  useSelectionSync,
} from './tableSelection.ts'

// The Table page's Floors and Zones views (decision 0032, stage 6): every
// building's floors, and every zone of the published zoning, sharing the
// selection with Properties and the Map. Zones are display only.

/** How the last run zoned the row's building, and whether by the project default or an override (decision 0034). */
type ZonedBy = { zoning: string | null; zoningSource: string | null }
type FloorRow = Floor & { buildingName: string } & ZonedBy
type ZoneRow = Zone & { buildingName: string } & ZonedBy

function zonedBy(
  state: Parameters<typeof buildingZoning>[0],
  buildingId: string,
): ZonedBy {
  const zoning = buildingZoning(state, buildingId)
  const published = publishedZoningOf(state, buildingId)
  return {
    zoning: zoning ? describeAppliedZoning(zoning) : null,
    zoningSource: published ? ZONING_SOURCE_LABELS[published.source] : null,
  }
}

/** The published zoning in words: the project's mode and how many buildings were zoned their own way. */
function describePublished(published: PublishedZoning): string {
  const own = Object.keys(published.overrides).length
  return `${describeZoning(published).toLowerCase()} by default${own > 0 ? `; ${own} building${own === 1 ? '' : 's'} zoned ${own === 1 ? 'its' : 'their'} own way` : ''}`
}

function zonedByColumns<Row extends ZonedBy>(): DataColumn<Row>[] {
  return [
    {
      id: 'zoning',
      header: 'Zoning',
      value: (row) => row.zoning,
      type: 'enum',
      empty: 'Not zoned',
      width: 220,
    },
    {
      id: 'zoningSource',
      header: 'Zoning from',
      value: (row) => row.zoningSource,
      type: 'enum',
      empty: 'Not zoned',
      width: 170,
    },
  ]
}

const rowId = (row: { id: string }) => row.id

function useBuildings(): Building[] {
  const buildings = useWorkbenchSnapshot((snapshot) => snapshot.state.buildings)
  const ids = useWorkbenchSnapshot((snapshot) => snapshot.state.buildingIds)
  return useMemo(
    () =>
      ids.flatMap((id) => {
        const building = buildings[id]
        return building ? [building] : []
      }),
    [ids, buildings],
  )
}

const FLOOR_COLUMNS: DataColumn<FloorRow>[] = [
  {
    id: 'id',
    header: 'ID',
    value: (row) => row.id,
    type: 'identifier',
    rowHeader: true,
    width: 130,
  },
  {
    id: 'buildingId',
    header: 'Building',
    value: (row) => row.buildingId,
    type: 'identifier',
    width: 110,
  },
  { id: 'buildingName', header: 'Name', value: (row) => row.buildingName },
  {
    id: 'number',
    header: 'Floor',
    value: (row) => row.number,
    type: 'number',
    width: 90,
  },
  {
    id: 'bottomM',
    header: 'From',
    unit: 'm',
    value: (row) => row.bottomM,
    type: 'number',
    decimals: 1,
    width: 100,
  },
  {
    id: 'topM',
    header: 'To',
    unit: 'm',
    value: (row) => row.topM,
    type: 'number',
    decimals: 1,
    width: 100,
  },
  {
    id: 'areaM2',
    header: 'Area',
    unit: 'm²',
    value: (row) => row.areaM2,
    type: 'number',
    width: 120,
  },
  {
    id: 'zones',
    header: 'Zones',
    value: (row) => row.zoneIds.length,
    type: 'number',
    width: 100,
  },
  ...zonedByColumns<FloorRow>(),
]

const ZONE_COLUMNS: DataColumn<ZoneRow>[] = [
  {
    id: 'id',
    header: 'ID',
    value: (row) => row.id,
    type: 'identifier',
    rowHeader: true,
    width: 140,
  },
  {
    id: 'buildingId',
    header: 'Building',
    value: (row) => row.buildingId,
    type: 'identifier',
    width: 110,
  },
  { id: 'name', header: 'Zone', value: (row) => row.name, width: 220 },
  {
    id: 'kind',
    header: 'Type',
    value: (row) => zoneTypeLabel(row),
    type: 'enum',
    width: 170,
  },
  {
    id: 'floor',
    header: 'Floor',
    value: (row) => row.floor,
    type: 'number',
    empty: 'All',
    width: 90,
  },
  {
    id: 'areaM2',
    header: 'Area',
    unit: 'm²',
    value: (row) => row.areaM2,
    type: 'number',
    width: 120,
  },
  {
    id: 'bottomM',
    header: 'From',
    unit: 'm',
    value: (row) => row.bottomM,
    type: 'number',
    decimals: 1,
    width: 100,
  },
  {
    id: 'topM',
    header: 'To',
    unit: 'm',
    value: (row) => row.topM,
    type: 'number',
    decimals: 1,
    width: 100,
  },
  ...zonedByColumns<ZoneRow>(),
]

export function FloorsTable() {
  const buildings = useBuildings()
  const zoning = useWorkbenchSnapshot((snapshot) => snapshot.state.zoning)
  const selection = useWorkbenchSnapshot((snapshot) => snapshot.state.selection)
  const apiRef = useRef<GridApi<FloorRow> | null>(null)
  const handleSelection = useSelectionHandler<FloorRow>('floor')
  const rows = useMemo(
    () =>
      buildings.flatMap((building) => {
        const scoped = { zoning, buildings: { [building.id]: building } }
        const by = zonedBy(scoped, building.id)
        return buildingFloors(scoped, building.id).map((floor) => ({
          ...floor,
          buildingName: building.name,
          ...by,
        }))
      }),
    [buildings, zoning],
  )
  const table = useWorkbenchTable({
    id: 'table.floors',
    label: 'Floors',
    columns: FLOOR_COLUMNS,
  })
  const [ready, setReady] = useState(false)
  useSelectionSync(apiRef, selection, 'floor', rows, ready)

  if (rows.length === 0) {
    return (
      <EmptyState
        title="No floors yet"
        message="Floors appear once Geospatial preprocessing has computed building heights; each floor is the height over the storeys."
        stageId={STAGE_IDS.preprocessing}
      />
    )
  }
  return (
    <div className={styles.tableView}>
      <p className={styles.hint}>
        Every building&rsquo;s floors: uniform, the height over the storeys.
        Choose one to see its building&rsquo;s floors and zones in Properties
        and the floor on the Map.
      </p>
      <GridTable<FloorRow>
        id="table.floors"
        aria-label="Floors"
        className={styles.gridTable}
        barClassName={styles.gridBar}
        columns={FLOOR_COLUMNS}
        rows={rows}
        rowKey={rowId}
        {...table}
        gridOptions={{
          rowSelection: ROW_SELECTION,
          onSelectionChanged: handleSelection,
          onGridReady: (event) => {
            apiRef.current = event.api
            setReady(true)
          },
        }}
      />
    </div>
  )
}

export function ZonesTable() {
  const buildings = useBuildings()
  const zoning = useWorkbenchSnapshot((snapshot) => snapshot.state.zoning)
  const selection = useWorkbenchSnapshot((snapshot) => snapshot.state.selection)
  const apiRef = useRef<GridApi<ZoneRow> | null>(null)
  const handleSelection = useSelectionHandler<ZoneRow>('zone')
  const rows = useMemo(
    () =>
      buildings.flatMap((building) => {
        const scoped = { zoning, buildings: { [building.id]: building } }
        const by = zonedBy(scoped, building.id)
        return (buildingZoning(scoped, building.id)?.zones ?? []).map(
          (zone) => ({ ...zone, buildingName: building.name, ...by }),
        )
      }),
    [buildings, zoning],
  )
  const table = useWorkbenchTable({
    id: 'table.zones',
    label: 'Zones',
    columns: ZONE_COLUMNS,
  })
  const [ready, setReady] = useState(false)
  useSelectionSync(apiRef, selection, 'zone', rows, ready)

  if (rows.length === 0) {
    return (
      <EmptyState
        title="No zones yet"
        message={
          zoning.published === null && buildings.some((b) => b.heightM !== null)
            ? 'These buildings were zoned before the zoning setting existed. Run Geospatial preprocessing again to zone them by the setting.'
            : 'Zones appear once Geospatial preprocessing has zoned the buildings by the zoning setting.'
        }
        stageId={STAGE_IDS.preprocessing}
      />
    )
  }
  const published = zoning.published
  return (
    <div className={styles.tableView}>
      <p className={styles.hint}>
        Every zone the last Geospatial preprocessing run made
        {published ? ` (${describePublished(published)})` : ''}. Zones are
        display only; choose one to see it in Properties and on the Map.
      </p>
      <GridTable<ZoneRow>
        id="table.zones"
        aria-label="Zones"
        className={styles.gridTable}
        barClassName={styles.gridBar}
        columns={ZONE_COLUMNS}
        rows={rows}
        rowKey={rowId}
        {...table}
        gridOptions={{
          rowSelection: ROW_SELECTION,
          onSelectionChanged: handleSelection,
          onGridReady: (event) => {
            apiRef.current = event.api
            setReady(true)
          },
        }}
      />
    </div>
  )
}
