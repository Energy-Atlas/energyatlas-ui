import type {
  CellEditRequestEvent,
  ColDef,
  GridApi,
  SelectionChangedEvent,
} from 'ag-grid-community'
import { AgGridReact } from 'ag-grid-react'
import { useEffect, useId, useMemo, useRef, useState } from 'react'
import {
  Input,
  SearchField,
  Tab,
  TabList,
  TabPanel,
  Tabs,
} from 'react-aria-components'
import type {
  Building,
  GridElement,
  SelectableEntity,
  Selection,
} from '../../domain/types.ts'
import { STAGE_IDS } from '../../domain/workflow.ts'
import {
  useServices,
  useClientSnapshot,
  useViewState,
  useWorkbenchSnapshot,
} from '../WorkbenchContext.tsx'
import { ActionButton } from '../components/ActionButton.tsx'
import { CapabilityBadge } from '../components/CapabilityBadge.tsx'
import { EmptyState } from '../components/EmptyState.tsx'
import formStyles from '../components/forms.module.css'
import { usePendingReason } from '../service/usePendingReason.ts'
import { workbenchColumnDefaults, workbenchGridTheme } from '../grid/agGrid.ts'
import styles from './table.module.css'

type BuildingRow = Building & { baselineMwh: number | null }

type GridRow = GridElement & {
  loadingPercent: number | null
  servedCount: number
}

const PENDING_CELL_CLASS = 'eaui-pending-cell'

// Grid selection events caused by our own syncing must not echo back as commands.
const PROGRAMMATIC_SOURCES = new Set([
  'api',
  'apiSelectAll',
  'rowDataChanged',
  'gridInitializing',
])

function useSelectionSync<Row extends { id: string }>(
  apiRef: React.RefObject<GridApi<Row> | null>,
  selection: Selection,
  entityType: SelectableEntity,
  rows: Row[],
) {
  useEffect(() => {
    const api = apiRef.current
    if (!api) return
    const wanted = new Set(
      selection.entityType === entityType ? selection.ids : [],
    )
    api.forEachNode((node) => {
      const shouldSelect = Boolean(node.data && wanted.has(node.data.id))
      if (node.isSelected() !== shouldSelect) {
        node.setSelected(shouldSelect, false, 'api')
      }
    })
    const first =
      selection.entityType === entityType ? selection.ids[0] : undefined
    const node = first ? api.getRowNode(first) : undefined
    if (node) api.ensureNodeVisible(node)
  }, [apiRef, selection, entityType, rows])
}

function useSelectionHandler<Row extends { id: string }>(
  entityType: SelectableEntity,
) {
  const { workbench } = useServices()
  return (event: SelectionChangedEvent<Row>) => {
    if (PROGRAMMATIC_SOURCES.has(event.source)) return
    const ids = event.api.getSelectedRows().map((row) => row.id)
    workbench.execute(
      ids.length > 0
        ? { type: 'selection.set', input: { entityType, ids } }
        : { type: 'selection.clear', input: {} },
    )
  }
}

export function TablePage() {
  const headingId = useId()
  const hasBuildings = useWorkbenchSnapshot(
    (snapshot) => snapshot.state.buildingIds.length > 0,
  )
  const { view: viewStore } = useServices()
  const view = useViewState((state) => state.table.view)

  return (
    <section className={styles.page} aria-labelledby={headingId}>
      <header className={styles.header}>
        <h2 id={headingId}>Table</h2>
        <CapabilityBadge id="table.pendingEdits" />
      </header>
      {hasBuildings ? (
        <Tabs
          className={styles.tabs}
          selectedKey={view}
          onSelectionChange={(key) => {
            const next = key === 'grid' ? 'grid' : 'buildings'
            if (next !== view) {
              viewStore.execute({
                type: 'table.setView',
                input: { view: next },
              })
            }
          }}
        >
          <TabList aria-label="Table views" className={styles.tabList}>
            <Tab id="buildings" className={styles.tab}>
              Buildings
            </Tab>
            <Tab id="grid" className={styles.tab}>
              Grid elements
            </Tab>
          </TabList>
          <TabPanel id="buildings" className={styles.panel}>
            <BuildingsTable />
          </TabPanel>
          <TabPanel id="grid" className={styles.panel}>
            <GridElementsTable />
          </TabPanel>
        </Tabs>
      ) : (
        <EmptyState
          title="No buildings yet"
          message="The table lists synthetic buildings once the first workflow stage has captured footprints."
          stageId={STAGE_IDS.location}
        />
      )}
    </section>
  )
}

function BuildingsTable() {
  const { workbench, client, view } = useServices()
  const applyingEdits = usePendingReason(
    'edits.apply',
    'the edits are being applied',
  )
  const transitioning = useClientSnapshot((snapshot) => snapshot.transitioning)
  const applying = transitioning
    ? 'The project session is changing. Wait for it to finish before editing.'
    : applyingEdits
  const buildings = useWorkbenchSnapshot((snapshot) => snapshot.state.buildings)
  const buildingIds = useWorkbenchSnapshot(
    (snapshot) => snapshot.state.buildingIds,
  )
  const archetypes = useWorkbenchSnapshot(
    (snapshot) => snapshot.state.archetypes,
  )
  const pendingEdits = useWorkbenchSnapshot(
    (snapshot) => snapshot.state.pendingEdits,
  )
  const baseline = useWorkbenchSnapshot(
    (snapshot) => snapshot.state.results.baseline,
  )
  const selection = useWorkbenchSnapshot((snapshot) => snapshot.state.selection)
  const apiRef = useRef<GridApi<BuildingRow> | null>(null)
  const storedFilter = useViewState((state) => state.table.quickFilter)
  // The field edits a local draft so typing stays responsive; the logged view
  // operation follows after a pause. A filter set elsewhere (for example by the
  // agent) replaces the draft.
  const [draft, setDraft] = useState({
    text: storedFilter,
    synced: storedFilter,
  })
  let quickFilter = draft.text
  if (draft.synced !== storedFilter) {
    quickFilter = storedFilter
    setDraft({ text: storedFilter, synced: storedFilter })
  }
  useEffect(() => {
    if (quickFilter === storedFilter) return
    const handle = window.setTimeout(() => {
      view.execute({
        type: 'table.setQuickFilter',
        input: { text: quickFilter },
      })
    }, 400)
    return () => window.clearTimeout(handle)
  }, [quickFilter, storedFilter, view])
  const [editError, setEditError] = useState<string | null>(null)
  const handleSelection = useSelectionHandler<BuildingRow>('building')

  const rows = useMemo(
    () =>
      buildingIds.flatMap((id): BuildingRow[] => {
        const building = buildings[id]
        if (!building) return []
        const floors = pendingEdits[`${id}:floors`]
        const archetype = pendingEdits[`${id}:archetypeId`]
        const kwh = baseline?.byBuildingKwh[id]
        return [
          {
            ...building,
            floors:
              typeof floors?.to === 'number' ? floors.to : building.floors,
            archetypeId:
              archetype &&
              (archetype.to === null || typeof archetype.to === 'string')
                ? archetype.to
                : building.archetypeId,
            baselineMwh: kwh === undefined ? null : Math.round(kwh / 100) / 10,
          },
        ]
      }),
    [buildingIds, buildings, pendingEdits, baseline],
  )

  const archetypeIds = useMemo(() => Object.keys(archetypes), [archetypes])
  const floorsEditable =
    applying === null && rows.some((row) => row.floors !== null)
  const archetypesEditable = applying === null && archetypeIds.length > 0

  const columns = useMemo<ColDef<BuildingRow>[]>(
    () => [
      { field: 'id', headerName: 'ID', width: 100, filter: true },
      { field: 'name', headerName: 'Name', width: 140, filter: true },
      { field: 'use', headerName: 'Use', width: 110, filter: true },
      {
        field: 'yearBuilt',
        headerName: 'Year built',
        width: 110,
        filter: 'agNumberColumnFilter',
      },
      {
        field: 'floors',
        headerName: 'Floors',
        width: 100,
        filter: 'agNumberColumnFilter',
        editable: floorsEditable,
        cellClassRules: {
          [PENDING_CELL_CLASS]: (params) =>
            Boolean(params.data && pendingEdits[`${params.data.id}:floors`]),
        },
      },
      { field: 'heightM', headerName: 'Height (m)', width: 110 },
      {
        field: 'floorAreaM2',
        headerName: 'Floor area (m²)',
        width: 130,
        filter: 'agNumberColumnFilter',
      },
      { field: 'zoneCount', headerName: 'Zones', width: 90 },
      {
        field: 'archetypeId',
        headerName: 'Archetype',
        width: 220,
        editable: archetypesEditable,
        cellEditor: 'agSelectCellEditor',
        cellEditorParams: { values: ['', ...archetypeIds] },
        valueFormatter: (params) => {
          const value = params.value as string | null | undefined
          return value ? (archetypes[value]?.name ?? value) : 'None'
        },
        cellClassRules: {
          [PENDING_CELL_CLASS]: (params) =>
            Boolean(
              params.data && pendingEdits[`${params.data.id}:archetypeId`],
            ),
        },
      },
      {
        field: 'pvYieldKwh',
        headerName: 'PV yield (kWh/yr)',
        width: 150,
        filter: 'agNumberColumnFilter',
      },
      {
        field: 'baselineMwh',
        headerName: 'Baseline (MWh/yr)',
        width: 150,
        filter: 'agNumberColumnFilter',
      },
    ],
    [
      floorsEditable,
      archetypesEditable,
      archetypeIds,
      archetypes,
      pendingEdits,
    ],
  )

  useSelectionSync(apiRef, selection, 'building', rows)

  const pendingCount = Object.keys(pendingEdits).length
  const selectedCount =
    selection.entityType === 'building' ? selection.ids.length : 0

  return (
    <div className={styles.tableView}>
      <div
        className={styles.toolbar}
        role="group"
        aria-label="Building table actions"
      >
        <SearchField
          aria-label="Filter buildings"
          className={styles.search}
          value={quickFilter}
          onChange={(text) => setDraft({ text, synced: storedFilter })}
        >
          <Input
            className={formStyles.input}
            placeholder="Filter rows"
            maxLength={100}
          />
        </SearchField>
        <span data-testid="pending-count">
          {pendingCount} pending {pendingCount === 1 ? 'edit' : 'edits'}
        </span>
        <ActionButton
          label="Apply pending edits"
          variant="primary"
          disabledReason={
            pendingCount > 0 ? applying : 'There are no pending edits.'
          }
          onPress={() => {
            setEditError(null)
            void client
              .execute({
                type: 'edits.apply',
                input: {},
              })
              .then((result) => {
                if (result.outcome.status === 'rejected') {
                  setEditError(
                    result.outcome.issues
                      .map((issue) => issue.message)
                      .join(' '),
                  )
                }
              })
          }}
        >
          Apply
        </ActionButton>
        <ActionButton
          label="Discard pending edits"
          disabledReason={
            pendingCount > 0 ? applying : 'There are no pending edits.'
          }
          onPress={() => {
            workbench.execute({ type: 'edits.discard', input: {} })
            setEditError(null)
          }}
        >
          Discard
        </ActionButton>
        <span className={styles.selectionCount}>{selectedCount} selected</span>
        <ActionButton
          label="Clear selection"
          disabledReason={selectedCount > 0 ? null : 'Nothing is selected.'}
          onPress={() =>
            workbench.execute({ type: 'selection.clear', input: {} })
          }
        >
          Clear selection
        </ActionButton>
      </div>
      {editError ? (
        <p className={formStyles.alert} role="alert">
          {editError}
        </p>
      ) : (
        <p className={styles.hint}>
          {applying
            ? 'Waiting for the server to answer Apply. Drafts can be changed or undone after it answers.'
            : 'Floors and archetype become editable once their stages have run. Edits stay pending, highlighted, until applied.'}
        </p>
      )}
      <div className={styles.grid}>
        <AgGridReact<BuildingRow>
          theme={workbenchGridTheme}
          defaultColDef={workbenchColumnDefaults}
          rowData={rows}
          columnDefs={columns}
          getRowId={(params) => params.data.id}
          quickFilterText={quickFilter}
          readOnlyEdit
          onCellEditRequest={(event: CellEditRequestEvent<BuildingRow>) => {
            const field = event.colDef.field
            if (field !== 'floors' && field !== 'archetypeId') return
            const raw: unknown = event.newValue
            const value =
              field === 'archetypeId'
                ? raw === '' || raw === null || raw === undefined
                  ? null
                  : typeof raw === 'string'
                    ? raw
                    : null
                : typeof raw === 'number' || typeof raw === 'string'
                  ? raw
                  : null
            const result = workbench.execute({
              type: 'edits.propose',
              input: { entityId: event.data.id, field, value },
            })
            setEditError(
              result.outcome.status === 'rejected'
                ? result.outcome.issues.map((issue) => issue.message).join(' ')
                : null,
            )
          }}
          rowSelection={{
            mode: 'multiRow',
            checkboxes: false,
            headerCheckbox: false,
            enableClickSelection: true,
          }}
          onSelectionChanged={handleSelection}
          onGridReady={(event) => {
            apiRef.current = event.api
          }}
        />
      </div>
    </div>
  )
}

function GridElementsTable() {
  const elements = useWorkbenchSnapshot(
    (snapshot) => snapshot.state.gridElements,
  )
  const gridResult = useWorkbenchSnapshot(
    (snapshot) => snapshot.state.gridResult,
  )
  const selection = useWorkbenchSnapshot((snapshot) => snapshot.state.selection)
  const apiRef = useRef<GridApi<GridRow> | null>(null)
  const handleSelection = useSelectionHandler<GridRow>('gridElement')

  const rows = useMemo(
    () =>
      Object.values(elements).map((element): GridRow => ({
        ...element,
        servedCount: element.buildingIds.length,
        loadingPercent:
          gridResult?.transformerLoadingPercent[element.id] ?? null,
      })),
    [elements, gridResult],
  )

  const columns = useMemo<ColDef<GridRow>[]>(
    () => [
      { field: 'id', headerName: 'ID', width: 110, filter: true },
      { field: 'kind', headerName: 'Kind', width: 120, filter: true },
      { field: 'name', headerName: 'Name', width: 190, filter: true },
      { field: 'ratingKva', headerName: 'Rating (kVA)', width: 130 },
      { field: 'servedCount', headerName: 'Buildings served', width: 150 },
      { field: 'loadingPercent', headerName: 'Peak loading (%)', width: 150 },
    ],
    [],
  )

  useSelectionSync(apiRef, selection, 'gridElement', rows)

  if (rows.length === 0) {
    return (
      <EmptyState
        title="No grid elements yet"
        message="Grid elements appear after the grid definitions stage runs."
        stageId={STAGE_IDS.gridDefinitions}
      />
    )
  }

  return (
    <div className={styles.tableView}>
      <p className={styles.hint}>
        Loading comes from the simulated grid modeling stage and is empty until
        it runs.
      </p>
      <div className={styles.grid}>
        <AgGridReact<GridRow>
          theme={workbenchGridTheme}
          defaultColDef={workbenchColumnDefaults}
          rowData={rows}
          columnDefs={columns}
          getRowId={(params) => params.data.id}
          rowSelection={{
            mode: 'multiRow',
            checkboxes: false,
            headerCheckbox: false,
            enableClickSelection: true,
          }}
          onSelectionChanged={handleSelection}
          onGridReady={(event) => {
            apiRef.current = event.api
          }}
        />
      </div>
    </div>
  )
}
