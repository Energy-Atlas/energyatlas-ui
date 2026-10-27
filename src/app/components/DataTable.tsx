import { useMemo, useState } from 'react'
import {
  Button,
  Cell,
  Column,
  ColumnResizer,
  ResizableTableContainer,
  Row,
  Table,
  TableBody,
  TableHeader,
  type SortDescriptor,
} from 'react-aria-components'
import { cx } from '../cx.ts'
import {
  columnAlign,
  columnHeader,
  fitWidths,
  formatCell,
  processRows,
  tableCsv,
  visibleColumns,
  type DataColumn,
} from '../tables/tableModel.ts'
import {
  nextHeaderSort,
  type TableChange,
  type TableSettings,
} from '../tables/tableSettings.ts'
import componentStyles from './components.module.css'
import styles from './dataTable.module.css'
import { ColumnTools, TableBar } from './tableTools.tsx'

export type DataTableProps<Row> = {
  /** Stable id: settings are kept under it and the agent names it. */
  id: string
  'aria-label': string
  columns: DataColumn<Row>[]
  rows: Row[]
  rowKey: (row: Row) => string
  settings: TableSettings
  onChange: (change: TableChange) => void
  /** Rows shown before "Show more"; all rows when omitted. */
  pageSize?: number
  /** Shown when the table has no rows at all. */
  emptyText?: string
  /** Download as CSV; null leaves the Download tool out. */
  exportOptions?: { fileName: string; context?: string[] } | null
  onExport?: (csv: string, fileName: string, rowCount: number) => void
  /** Marks the current row, such as the drilled-down building. */
  currentKey?: string | null
  className?: string
}

type Item<Row> = { id: string; row: Row }

const ALIGN_CLASS = {
  start: undefined,
  center: styles.center,
  end: styles.end,
} satisfies Record<'start' | 'center' | 'end', string | undefined>

/**
 * Marks the header of the column holding `target` (a cell or anything in
 * one), so that column's widgets show; null clears the mark. The mark is a
 * data attribute React does not manage, so re-renders keep it.
 */
function markColumn(zone: HTMLElement, target: EventTarget | null) {
  const cell =
    target instanceof Element
      ? target.closest<HTMLTableCellElement>('td, th')
      : null
  const header =
    cell && zone.contains(cell)
      ? zone.querySelector('table')?.tHead?.rows[0]?.cells[cell.cellIndex]
      : undefined
  for (const marked of zone.querySelectorAll('[data-column-hover]')) {
    if (marked !== header) marked.removeAttribute('data-column-hover')
  }
  header?.setAttribute('data-column-hover', '')
}

/**
 * The shared data table (decision 0027): React Aria's grid with a table
 * toolbar (columns, filters, download, style) and two widgets per column
 * (filter and sort, format). Widgets appear on hover or focus; any that is
 * in use stays visible, and a filtered table always says how many rows show.
 * Settings are controlled, so pages keep them in view state.
 */
export function DataTable<Row>({
  id,
  'aria-label': label,
  columns,
  rows,
  rowKey,
  settings,
  onChange,
  pageSize,
  emptyText = 'No rows.',
  exportOptions = null,
  onExport,
  currentKey = null,
  className,
}: DataTableProps<Row>) {
  const [shownCount, setShownCount] = useState(pageSize ?? Infinity)
  const shownColumns = visibleColumns(columns, settings)
  const processed = useMemo(
    () => processRows(rows, columns, settings),
    [rows, columns, settings],
  )
  const page = processed.slice(0, shownCount)
  const items: Item<Row>[] = page.map((row) => ({ id: rowKey(row), row }))
  const { style } = settings
  const widths = useMemo(
    () => fitWidths(rows, columns, settings),
    [rows, columns, settings],
  )

  const sortDescriptor: SortDescriptor | undefined = settings.sort
    ? { column: settings.sort.column, direction: settings.sort.direction }
    : undefined

  // Default widths share the space but never cut a value short: each
  // column's minimum is its fitted width, so a narrow pane scrolls sideways.
  // Long-text columns wrap instead, from a readable minimum.
  const widthOf = (column: DataColumn<Row>) =>
    style.widths === 'even'
      ? '1fr'
      : style.widths === 'fit'
        ? (widths[column.id] ?? 120)
        : (column.width ?? '1fr')
  const minWidthOf = (column: DataColumn<Row>) =>
    style.widths !== 'default'
      ? 64
      : column.wrap
        ? 160
        : Math.min(widths[column.id] ?? 64, column.width ?? Infinity)

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
    })
    onExport(csv, exportOptions.fileName, processed.length)
  }

  return (
    <div
      className={cx(
        styles.frame,
        style.density === 'comfortable' && styles.comfortable,
        style.shaded && styles.shaded,
        style.wrap && styles.wrap,
        style.freezeFirst && styles.freeze,
        style.freezeHeader && styles.freezeHeader,
        className,
      )}
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
      />

      <div
        className={styles.hoverZone}
        // A column's widgets show while the pointer or focus is anywhere in
        // that column, not only on its header.
        onPointerOver={(event) => markColumn(event.currentTarget, event.target)}
        onPointerLeave={(event) => markColumn(event.currentTarget, null)}
        onFocus={(event) => markColumn(event.currentTarget, event.target)}
        onBlur={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget)) {
            markColumn(event.currentTarget, null)
          }
        }}
      >
        <ResizableTableContainer
          // Changing the width mode re-applies its default widths.
          key={`${style.widths}:${shownColumns.map((column) => column.id).join('|')}`}
          className={styles.scroll}
        >
          <Table
            aria-label={label}
            className={styles.table}
            sortDescriptor={sortDescriptor}
            // Clicking a header steps through ascending, descending, and
            // unsorted.
            onSortChange={(descriptor) =>
              onChange({
                kind: 'sort',
                sort: nextHeaderSort(settings.sort, String(descriptor.column)),
              })
            }
          >
            <TableHeader columns={shownColumns} dependencies={[settings, rows]}>
              {(column) => (
                <Column
                  id={column.id}
                  isRowHeader={column.rowHeader}
                  allowsSorting={!column.action && column.sortable !== false}
                  defaultWidth={widthOf(column)}
                  minWidth={minWidthOf(column)}
                  textValue={columnHeader(column, settings.formats[column.id])}
                  className={cx(
                    styles.th,
                    ALIGN_CLASS[
                      columnAlign(column, settings.formats[column.id])
                    ],
                  )}
                >
                  <ColumnHead
                    column={column}
                    rows={rows}
                    settings={settings}
                    onChange={onChange}
                  />
                </Column>
              )}
            </TableHeader>
            <TableBody
              items={items}
              dependencies={[settings, shownColumns]}
              className={styles.tbody}
              renderEmptyState={() => (
                <p className={styles.emptyRow}>
                  {rows.length === 0 ? (
                    emptyText
                  ) : (
                    <>
                      No rows match the filters.{' '}
                      <Button
                        className={componentStyles.button}
                        onPress={() => onChange({ kind: 'clearFilters' })}
                      >
                        Clear filters
                      </Button>
                    </>
                  )}
                </p>
              )}
            >
              {(item) => (
                <Row
                  id={item.id}
                  columns={shownColumns}
                  dependencies={[settings]}
                  className={cx(
                    styles.tr,
                    item.id === currentKey && styles.current,
                  )}
                >
                  {(column) => {
                    const format = settings.formats[column.id]
                    const text = formatCell(
                      column.value(item.row),
                      column,
                      format,
                    )
                    return (
                      <Cell
                        textValue={text}
                        className={cx(
                          styles.td,
                          column.wrap && styles.wrapCell,
                          ALIGN_CLASS[columnAlign(column, format)],
                        )}
                      >
                        {column.render ? column.render(item.row, text) : text}
                        {column.rowHeader && item.id === currentKey ? (
                          <span className="visually-hidden"> (current)</span>
                        ) : null}
                      </Cell>
                    )
                  }}
                </Row>
              )}
            </TableBody>
          </Table>
        </ResizableTableContainer>
      </div>

      {processed.length > page.length && pageSize ? (
        <p className={styles.more}>
          Showing {page.length.toLocaleString('en-US')} of{' '}
          {processed.length.toLocaleString('en-US')}.{' '}
          <button
            type="button"
            className={componentStyles.button}
            onClick={() => setShownCount(page.length + pageSize)}
          >
            Show {Math.min(pageSize, processed.length - page.length)} more
          </button>
        </p>
      ) : null}
    </div>
  )
}

/** A column header: name, the two widgets, and a resizer. */
function ColumnHead<Row>({
  column,
  rows,
  settings,
  onChange,
}: {
  column: DataColumn<Row>
  rows: Row[]
  settings: TableSettings
  onChange: (change: TableChange) => void
}) {
  const header = columnHeader(column, settings.formats[column.id])
  if (column.action) {
    return <span className="visually-hidden">{column.header}</span>
  }
  return (
    <div className={styles.head}>
      <span className={styles.headLabel}>{header}</span>
      <ColumnTools
        column={column}
        rows={rows}
        settings={settings}
        onChange={onChange}
      />
      <ColumnResizer
        className={styles.resizer}
        aria-label={`Resize ${column.header}`}
      />
    </div>
  )
}
