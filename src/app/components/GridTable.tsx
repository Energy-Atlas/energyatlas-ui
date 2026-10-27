import type {
  ColDef,
  IHeaderParams,
  SuppressHeaderKeyboardEventParams,
} from 'ag-grid-community'
import { AgGridReact, type AgGridReactProps } from 'ag-grid-react'
import { createContext, useContext, useMemo, type ReactNode } from 'react'
import { cx } from '../cx.ts'
import {
  shadedGridTheme,
  workbenchColumnDefaults,
  workbenchGridTheme,
} from '../grid/agGrid.ts'
import {
  columnAlign,
  columnHeader,
  fitWidths,
  formatCell,
  processRows,
  searchRows,
  tableCsv,
  visibleColumns,
  type DataColumn,
} from '../tables/tableModel.ts'
import type { TableChange, TableSettings } from '../tables/tableSettings.ts'
import componentStyles from './components.module.css'
import styles from './dataTable.module.css'
import { ColumnTools, TableBar, type FixedStyle } from './tableTools.tsx'

export type GridTableProps<Row> = {
  /** Stable id: settings are kept under it and the agent names it. */
  id: string
  'aria-label': string
  columns: DataColumn<Row>[]
  rows: Row[]
  rowKey: (row: Row) => string
  settings: TableSettings
  onChange: (change: TableChange) => void
  /** Text each shown row contains in a shown column, such as a search field. */
  search?: string
  onClearSearch?: () => void
  /** Leads the table bar, such as the search field. */
  barStart?: ReactNode
  barClassName?: string
  /** AG Grid options for single columns, such as editing, by column id. */
  columnOptions?: Partial<Record<string, ColDef<Row>>>
  /** AG Grid options the page owns, such as selection and editing events. */
  gridOptions?: AgGridReactProps<Row>
  /** Download as CSV; null leaves the Download tool out. */
  exportOptions?: { fileName: string; context?: string[] } | null
  onExport?: (csv: string, fileName: string, rowCount: number) => void
  className?: string
}

const ALIGN_CLASS = {
  start: '',
  center: styles.center,
  end: styles.end,
} satisfies Record<'start' | 'center' | 'end', string | undefined>

const NO_COLUMN_OPTIONS = {}

const ROW_HEIGHT = { compact: 30, comfortable: 38 } as const

// AG Grid always keeps its header row in view.
const FIXED_STYLE: FixedStyle = {
  freezeHeader: 'This grid always keeps its header row in place.',
}

type HeaderContextValue = {
  columns: Map<string, DataColumn<unknown>>
  rows: unknown[]
  settings: TableSettings
  onChange: (change: TableChange) => void
}

// Headers read the table through context: AG Grid renders them through
// portals, which keep React context, and they then follow every change
// without their column definitions changing.
const HeaderContext = createContext<HeaderContextValue | null>(null)

/**
 * The shared table contract (decision 0027) drawn by AG Grid, for the large,
 * virtualised grids of the Table page: the same table bar and column widgets
 * as DataTable, over rows the shared model filters and sorts, so both
 * renderers agree. AG Grid's own sorting, filters, and menus are off.
 */
export function GridTable<Row>({
  id,
  'aria-label': label,
  columns,
  rows,
  rowKey,
  settings,
  onChange,
  search = '',
  onClearSearch,
  barStart,
  barClassName,
  columnOptions = NO_COLUMN_OPTIONS,
  gridOptions = {},
  exportOptions = null,
  onExport,
  className,
}: GridTableProps<Row>) {
  const { style } = settings
  const processed = useMemo(
    () =>
      processRows(
        searchRows(rows, columns, settings, search),
        columns,
        settings,
      ),
    [rows, columns, settings, search],
  )
  const widths = useMemo(
    () => fitWidths(rows, columns, settings),
    [rows, columns, settings],
  )
  // AG Grid holds the sort, so the header carries it to assistive technology
  // and Enter on a header steps it, but the order is the shared model's.
  const rank = useMemo(
    () => new Map(processed.map((row, index) => [rowKey(row), index])),
    [processed, rowKey],
  )

  const columnDefs = useMemo(
    () =>
      visibleColumns(columns, settings).map((column, index): ColDef<Row> => {
        const format = settings.formats[column.id]
        const align = ALIGN_CLASS[columnAlign(column, format)]
        const wrap = style.wrap || Boolean(column.wrap)
        return {
          colId: column.id,
          headerName: columnHeader(column, format),
          valueGetter: (params) =>
            params.data ? column.value(params.data) : null,
          valueFormatter: (params) =>
            formatCell(params.value as string | number | null, column, format),
          cellDataType: false,
          headerComponent: GridColumnHeader,
          headerClass: align,
          cellClass: align,
          sortable: !column.action && column.sortable !== false,
          sort:
            settings.sort?.column === column.id
              ? settings.sort.direction === 'ascending'
                ? 'asc'
                : 'desc'
              : null,
          comparator: (_a, _b, nodeA, nodeB) => {
            const a = nodeA.data ? rank.get(rowKey(nodeA.data)) : undefined
            const b = nodeB.data ? rank.get(rowKey(nodeB.data)) : undefined
            // Descending reverses the comparator, so undo it.
            const order = (a ?? 0) - (b ?? 0)
            return settings.sort?.direction === 'descending' ? -order : order
          },
          filter: false,
          suppressHeaderMenuButton: true,
          suppressHeaderFilterButton: true,
          suppressMovable: true,
          suppressHeaderKeyboardEvent: headerKeyboardEvent,
          // Null clears what an earlier style set; AG Grid keeps the rest.
          pinned: style.freezeFirst && index === 0 ? 'left' : null,
          ...(style.widths === 'even'
            ? { flex: 1, minWidth: 64 }
            : {
                flex: null,
                width:
                  style.widths === 'fit'
                    ? widths[column.id]
                    : // Never narrower than the content and the widgets.
                      Math.max(column.width ?? 0, widths[column.id] ?? 0),
              }),
          wrapText: wrap,
          autoHeight: wrap,
          ...columnOptions[column.id],
        }
      }),
    [columns, settings, style, widths, columnOptions, rank, rowKey],
  )

  const header = useMemo<HeaderContextValue>(
    () => ({
      columns: new Map(
        columns.map((column) => [column.id, column as DataColumn<unknown>]),
      ),
      rows,
      settings,
      onChange,
    }),
    [columns, rows, settings, onChange],
  )

  const exportCsv = () => {
    if (!exportOptions || !onExport) return
    const csv = tableCsv({
      label,
      columns,
      rows: processed,
      total: rows.length,
      settings,
      exportedAt: new Date().toISOString(),
      context: exportOptions.context,
      search,
    })
    onExport(csv, exportOptions.fileName, processed.length)
  }

  const filtersSet = Object.keys(settings.filters).length > 0
  return (
    <div
      className={cx(styles.frame, styles.gridFrame, className)}
      data-table-id={id}
    >
      <TableBar
        label={label}
        columns={columns}
        settings={settings}
        total={rows.length}
        shown={processed.length}
        onChange={onChange}
        onExport={exportOptions && onExport ? exportCsv : null}
        fixedStyle={FIXED_STYLE}
        start={barStart}
        className={barClassName}
      />
      {processed.length === 0 && rows.length > 0 ? (
        <p className={cx(styles.emptyRow, barClassName)}>
          No rows match{' '}
          {filtersSet && search.trim()
            ? 'the filters and search'
            : filtersSet
              ? 'the filters'
              : 'the search'}
          .{' '}
          {filtersSet ? (
            <button
              type="button"
              className={componentStyles.button}
              onClick={() => onChange({ kind: 'clearFilters' })}
            >
              Clear filters
            </button>
          ) : null}{' '}
          {search.trim() && onClearSearch ? (
            <button
              type="button"
              className={componentStyles.button}
              onClick={onClearSearch}
            >
              Clear search
            </button>
          ) : null}
        </p>
      ) : null}
      <div
        className={styles.gridZone}
        // A column's widgets show while the pointer or focus is anywhere in
        // that column, not only on its header.
        onPointerOver={(event) =>
          markGridColumn(event.currentTarget, event.target)
        }
        onPointerLeave={(event) => markGridColumn(event.currentTarget, null)}
        onFocus={(event) => markGridColumn(event.currentTarget, event.target)}
        onBlur={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget)) {
            markGridColumn(event.currentTarget, null)
          }
        }}
      >
        <HeaderContext.Provider value={header}>
          <AgGridReact<Row>
            theme={style.shaded ? shadedGridTheme : workbenchGridTheme}
            defaultColDef={workbenchColumnDefaults}
            rowHeight={ROW_HEIGHT[style.density]}
            rowData={processed}
            columnDefs={columnDefs}
            getRowId={(params) => rowKey(params.data)}
            suppressNoRowsOverlay
            suppressMultiSort
            animateRows={false}
            onSortChanged={(event) => {
              // Only the reader's own steps; settings drive the rest.
              if (event.source !== 'uiColumnSorted') return
              const sorted = event.api
                .getColumnState()
                .find((state) => state.sort)
              onChange({
                kind: 'sort',
                sort:
                  sorted?.sort && sorted.colId
                    ? {
                        column: sorted.colId,
                        direction:
                          sorted.sort === 'asc' ? 'ascending' : 'descending',
                      }
                    : null,
              })
            }}
            {...gridOptions}
          />
        </HeaderContext.Provider>
      </div>
    </div>
  )
}

/**
 * Marks the header of the grid column holding `target` (a cell or anything
 * in one), so that column's widgets show; null clears the mark. AG Grid
 * names each cell's column in its `col-id` attribute.
 */
function markGridColumn(zone: HTMLElement, target: EventTarget | null) {
  const cell = target instanceof Element ? target.closest('[col-id]') : null
  const columnId =
    cell && zone.contains(cell) ? cell.getAttribute('col-id') : null
  const header = columnId
    ? zone.querySelector(`.ag-header-cell[col-id="${CSS.escape(columnId)}"]`)
    : null
  for (const marked of zone.querySelectorAll('[data-column-hover]')) {
    if (marked !== header) marked.removeAttribute('data-column-hover')
  }
  header?.setAttribute('data-column-hover', '')
}

/**
 * Keyboard in a grid header. Tab from a header steps into its widgets and
 * back out to the next header; other keys on a widget belong to the widget,
 * not to the grid's header navigation.
 */
function headerKeyboardEvent<Row>({
  event,
}: SuppressHeaderKeyboardEventParams<Row>): boolean {
  const target = event.target
  if (!(target instanceof HTMLElement)) return false
  const cell = target.closest<HTMLElement>('.ag-header-cell')
  if (!cell) return false
  if (event.key !== 'Tab') return target !== cell
  const widgets = [...cell.querySelectorAll<HTMLElement>('button')]
  const index = widgets.indexOf(target)
  const next =
    index === -1 ? (event.shiftKey ? -2 : 0) : index + (event.shiftKey ? -1 : 1)
  if (next === -1) {
    event.preventDefault()
    cell.focus()
    return true
  }
  if (next >= 0 && next < widgets.length) {
    event.preventDefault()
    widgets[next]?.focus()
    return true
  }
  return false
}

/**
 * A grid column header: the name, which sorts on click or Enter (ascending,
 * descending, unsorted), and the column's two widgets.
 */
function GridColumnHeader({ column: gridColumn, progressSort }: IHeaderParams) {
  const table = useContext(HeaderContext)
  const columnId = gridColumn.getColId()
  const column = table?.columns.get(columnId)
  if (!table || !column) return null
  const sortable = !column.action && column.sortable !== false
  return (
    <div
      className={cx(styles.head, styles.gridHead, sortable && styles.sortable)}
      onClick={(event) => {
        // Clicks in a widget, or in its popover (a portal), do not sort.
        const target = event.target
        if (
          !sortable ||
          !(target instanceof Node) ||
          !event.currentTarget.contains(target) ||
          (target instanceof Element && target.closest('button'))
        ) {
          return
        }
        progressSort(false)
      }}
    >
      <span className={styles.headLabel}>
        {columnHeader(column, table.settings.formats[columnId])}
      </span>
      <ColumnTools
        column={column}
        rows={table.rows}
        settings={table.settings}
        onChange={table.onChange}
      />
    </div>
  )
}
