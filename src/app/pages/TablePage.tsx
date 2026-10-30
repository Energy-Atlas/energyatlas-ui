import type { CellEditRequestEvent, ColDef, GridApi } from 'ag-grid-community'
import { useEffect, useId, useMemo, useRef, useState } from 'react'
import {
  Input,
  SearchField,
  Tab,
  TabList,
  TabPanel,
  Tabs,
} from 'react-aria-components'
import type { Building, GridElement } from '../../domain/types.ts'
import { STAGE_IDS } from '../../domain/workflow.ts'
import {
  PART_LABELS,
  archetypeLabel,
  effectiveParts,
} from '../../domain/archetypes/parts.ts'
import { PART_KINDS, type PartKind } from '../../domain/types.ts'
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
import { GridTable } from '../components/GridTable.tsx'
import { InlineAlert } from '../components/InlineAlert.tsx'
import { PanelHeader } from '../components/PanelHeader.tsx'
import { useWorkbenchTable } from '../components/useWorkbenchTable.ts'
import { usePendingReason } from '../service/usePendingReason.ts'
import { TABLE_VIEWS } from '../view/tableViews.ts'
import {
  FloorsTable,
  ZonesTable,
  zonedBy,
  zonedByColumns,
  type ZonedBy,
} from './FloorZoneTables.tsx'
import {
  ROW_SELECTION,
  useSelectionHandler,
  useSelectionSync,
} from './tableSelection.ts'
import type { DataColumn } from '../tables/tableModel.ts'
import styles from './table.module.css'

type BuildingRow = Building & {
  baselineMwh: number | null
  /** The part of each kind that applies, with a pending edit laid over it. */
  partIds: Record<PartKind, string | null>
  archetype: string | null
  assignedBy: string | null
} & ZonedBy

/** Column id of a part column. */
const partColumn = (kind: PartKind) => `part:${kind}`

/** The value the part editor uses for following the rules again. */
const BY_RULES = ''

type GridRow = GridElement & {
  loadingPercent: number | null
  servedCount: number
}

const PENDING_CELL_CLASS = 'eaui-pending-cell'

// A stable row key, so the grid's column definitions do not change on
// every render.
const rowId = (row: { id: string }) => row.id

export function TablePage() {
  const headingId = useId()
  const hasBuildings = useWorkbenchSnapshot(
    (snapshot) => snapshot.state.buildingIds.length > 0,
  )
  const { view: viewStore } = useServices()
  const view = useViewState((state) => state.table.view)

  return (
    <section className={styles.page} aria-labelledby={headingId}>
      <PanelHeader
        className={styles.header}
        title="Table"
        headingId={headingId}
        meta={<CapabilityBadge id="table.pendingEdits" />}
      />
      {hasBuildings ? (
        <Tabs
          className={styles.tabs}
          selectedKey={view}
          onSelectionChange={(key) => {
            const next = TABLE_VIEWS.find((each) => each === key) ?? 'buildings'
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
            <Tab id="floors" className={styles.tab}>
              Floors
            </Tab>
            <Tab id="zones" className={styles.tab}>
              Zones
            </Tab>
            <Tab id="grid" className={styles.tab}>
              Grid elements
            </Tab>
          </TabList>
          <TabPanel id="buildings" className={styles.panel}>
            <BuildingsTable />
          </TabPanel>
          <TabPanel id="floors" className={styles.panel}>
            <FloorsTable />
          </TabPanel>
          <TabPanel id="zones" className={styles.panel}>
            <ZonesTable />
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
  const { workbench, client, view, viewOnly } = useServices()
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
  const parts = useWorkbenchSnapshot((snapshot) => snapshot.state.parts)
  const overrides = useWorkbenchSnapshot((snapshot) => snapshot.state.overrides)
  const zoning = useWorkbenchSnapshot((snapshot) => snapshot.state.zoning)
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
        const kwh = baseline?.byBuildingKwh[id]
        const effective = effectiveParts({ overrides }, building)
        const partIds = {} as Record<PartKind, string | null>
        for (const kind of PART_KINDS) {
          const edit = pendingEdits[`${id}:${kind}`]
          // A pending "follow the rules" shows the published rule part.
          partIds[kind] = edit
            ? typeof edit.to === 'string'
              ? edit.to
              : (building.parts[kind]?.partId ?? null)
            : (effective[kind]?.partId ?? null)
        }
        // Provenance: the rules that set the parts, and which parts are manual.
        const rules = [
          ...new Set(
            PART_KINDS.flatMap((kind) => {
              const part = effective[kind]
              return part?.via === 'rule' ? [part.ruleName] : []
            }),
          ),
        ]
        const manual = PART_KINDS.filter(
          (kind) => effective[kind]?.via === 'manual',
        )
        const assignedBy = [
          ...(manual.length > 0
            ? [
                `Manual ${manual.map((kind) => PART_LABELS[kind].toLowerCase()).join(', ')}`,
              ]
            : []),
          ...rules,
        ].join('; ')
        return [
          {
            ...building,
            floors:
              typeof floors?.to === 'number' ? floors.to : building.floors,
            partIds,
            archetype: archetypeLabel({ overrides, archetypes }, building),
            assignedBy: assignedBy || null,
            baselineMwh: kwh === undefined ? null : Math.round(kwh / 100) / 10,
            ...zonedBy({ zoning, buildings }, id),
          },
        ]
      }),
    [
      buildingIds,
      buildings,
      pendingEdits,
      baseline,
      overrides,
      archetypes,
      zoning,
    ],
  )

  const partIdsByKind = useMemo(() => {
    const byKind = Object.fromEntries(
      PART_KINDS.map((kind) => [kind, [] as string[]]),
    ) as Record<PartKind, string[]>
    for (const part of Object.values(parts)) byKind[part.kind].push(part.id)
    return byKind
  }, [parts])
  const floorsEditable =
    applying === null && rows.some((row) => row.floors !== null)

  const columns = useMemo<DataColumn<BuildingRow>[]>(
    () => [
      {
        id: 'id',
        header: 'ID',
        value: (row) => row.id,
        type: 'identifier',
        rowHeader: true,
        width: 100,
      },
      { id: 'name', header: 'Name', value: (row) => row.name, width: 140 },
      {
        id: 'use',
        header: 'Use',
        value: (row) => row.use,
        type: 'enum',
        width: 110,
      },
      {
        id: 'yearBuilt',
        header: 'Year built',
        value: (row) => row.yearBuilt,
        type: 'number',
        grouping: false,
        width: 120,
      },
      {
        id: 'floors',
        header: 'Floors',
        value: (row) => row.floors,
        type: 'number',
        width: 100,
      },
      {
        id: 'heightM',
        header: 'Height',
        unit: 'm',
        value: (row) => row.heightM,
        type: 'number',
        decimals: 1,
        width: 110,
      },
      {
        id: 'floorAreaM2',
        header: 'Floor area',
        unit: 'm²',
        value: (row) => row.floorAreaM2,
        type: 'number',
        width: 140,
      },
      {
        id: 'zoneCount',
        header: 'Zones',
        value: (row) => row.zoneCount,
        type: 'number',
        width: 100,
      },
      ...zonedByColumns<BuildingRow>(),
      {
        id: 'archetype',
        header: 'Archetype',
        value: (row) => row.archetype,
        type: 'enum',
        empty: 'None',
        width: 200,
      },
      ...PART_KINDS.map((kind): DataColumn<BuildingRow> => ({
        id: partColumn(kind),
        header: PART_LABELS[kind],
        value: (row) => {
          const id = row.partIds[kind]
          return id ? (parts[id]?.name ?? id) : null
        },
        type: 'enum',
        empty: 'None',
        width: 200,
      })),
      {
        id: 'assignedBy',
        header: 'Assigned by',
        value: (row) => row.assignedBy,
        empty: 'Not assigned',
        width: 220,
      },
      {
        id: 'pvYieldKwh',
        header: 'PV yield',
        unit: 'kWh/yr',
        value: (row) => row.pvYieldKwh,
        type: 'number',
        width: 160,
      },
      {
        id: 'baselineMwh',
        header: 'Baseline',
        unit: 'MWh/yr',
        value: (row) => row.baselineMwh,
        type: 'number',
        decimals: 1,
        width: 160,
      },
    ],
    [parts],
  )

  // Editing is AG Grid's own; edits go to drafts through `edits.propose`.
  const columnOptions = useMemo<Partial<Record<string, ColDef<BuildingRow>>>>(
    () => ({
      floors: {
        // The viewer edits nothing (decision 0032, stage 5).
        editable: !viewOnly && floorsEditable,
        cellEditor: 'agNumberCellEditor',
        cellClassRules: {
          [PENDING_CELL_CLASS]: (params) =>
            Boolean(params.data && pendingEdits[`${params.data.id}:floors`]),
        },
      },
      // A part's editor works on part ids and names them; choosing "By
      // rules" drops a manual part (decision 0032).
      ...Object.fromEntries(
        PART_KINDS.map((kind): [string, ColDef<BuildingRow>] => {
          const name = (value: unknown) =>
            typeof value === 'string' && value !== BY_RULES
              ? (parts[value]?.name ?? value)
              : 'By rules'
          return [
            partColumn(kind),
            {
              editable:
                !viewOnly &&
                applying === null &&
                partIdsByKind[kind].length > 0,
              valueGetter: (params) => params.data?.partIds[kind] ?? BY_RULES,
              valueFormatter: (params) =>
                params.value === BY_RULES ? 'None' : name(params.value),
              cellEditor: 'agSelectCellEditor',
              cellEditorParams: {
                values: [BY_RULES, ...partIdsByKind[kind]],
                formatValue: name,
              },
              cellClassRules: {
                [PENDING_CELL_CLASS]: (params) =>
                  Boolean(
                    params.data && pendingEdits[`${params.data.id}:${kind}`],
                  ),
              },
            },
          ]
        }),
      ),
    }),
    [floorsEditable, applying, partIdsByKind, parts, pendingEdits, viewOnly],
  )
  const table = useWorkbenchTable({
    id: 'table.buildings',
    label: 'Buildings',
    columns,
  })

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
        {viewOnly ? null : (
          <>
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
          </>
        )}
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
      {viewOnly ? (
        <p className={styles.hint}>
          Values as handed over. The viewer is view only, so cells cannot be
          edited; sort, filter, and arrange columns freely.
        </p>
      ) : editError ? (
        <InlineAlert tone="danger">{editError}</InlineAlert>
      ) : (
        <p className={styles.hint}>
          {applying
            ? 'Waiting for the server to answer Apply. Drafts can be changed or undone after it answers.'
            : 'Floors and archetype parts become editable once their stages have run. A part set here wins over the assignment rules; By rules drops it. Edits stay pending, highlighted, until applied.'}
        </p>
      )}
      <GridTable<BuildingRow>
        id="table.buildings"
        aria-label="Buildings"
        className={styles.gridTable}
        barClassName={styles.gridBar}
        columns={columns}
        rows={rows}
        rowKey={rowId}
        {...table}
        search={quickFilter}
        onClearSearch={() => setDraft({ text: '', synced: storedFilter })}
        barStart={
          <SearchField
            aria-label="Search buildings"
            className={styles.search}
            value={quickFilter}
            onChange={(text) => setDraft({ text, synced: storedFilter })}
          >
            <Input
              className={formStyles.input}
              placeholder="Search rows"
              maxLength={100}
            />
          </SearchField>
        }
        columnOptions={columnOptions}
        gridOptions={{
          readOnlyEdit: true,
          // Sixteen columns are cheap to draw; drawing them all keeps the part
          // columns reachable without scrolling first (decision 0032).
          suppressColumnVirtualisation: true,
          onCellEditRequest: (event: CellEditRequestEvent<BuildingRow>) => {
            const columnId = event.column.getColId()
            const kind = PART_KINDS.find(
              (each) => partColumn(each) === columnId,
            )
            if (columnId !== 'floors' && !kind) return
            const field = kind ?? 'floors'
            const raw: unknown = event.newValue
            const value = kind
              ? typeof raw === 'string' && raw !== BY_RULES
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
          },
          rowSelection: ROW_SELECTION,
          onSelectionChanged: handleSelection,
          onGridReady: (event) => {
            apiRef.current = event.api
          },
        }}
      />
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

  const columns = useMemo<DataColumn<GridRow>[]>(
    () => [
      {
        id: 'id',
        header: 'ID',
        value: (row) => row.id,
        type: 'identifier',
        rowHeader: true,
        width: 110,
      },
      {
        id: 'kind',
        header: 'Kind',
        value: (row) => row.kind,
        type: 'enum',
        width: 130,
      },
      { id: 'name', header: 'Name', value: (row) => row.name, width: 190 },
      {
        id: 'ratingKva',
        header: 'Rating',
        unit: 'kVA',
        value: (row) => row.ratingKva,
        type: 'number',
        width: 130,
      },
      {
        id: 'servedCount',
        header: 'Buildings served',
        value: (row) => row.servedCount,
        type: 'number',
        width: 160,
      },
      {
        id: 'loadingPercent',
        header: 'Peak loading',
        unit: '%',
        value: (row) => row.loadingPercent,
        type: 'number',
        decimals: 1,
        width: 160,
      },
    ],
    [],
  )
  const table = useWorkbenchTable({
    id: 'table.gridElements',
    label: 'Grid elements',
    columns,
  })

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
      <GridTable<GridRow>
        id="table.gridElements"
        aria-label="Grid elements"
        className={styles.gridTable}
        barClassName={styles.gridBar}
        columns={columns}
        rows={rows}
        rowKey={rowId}
        {...table}
        gridOptions={{
          rowSelection: ROW_SELECTION,
          onSelectionChanged: handleSelection,
          onGridReady: (event) => {
            apiRef.current = event.api
          },
        }}
      />
    </div>
  )
}
