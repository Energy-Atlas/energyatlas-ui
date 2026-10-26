import {
  ArrowDown,
  ArrowUp,
  Columns3,
  Download,
  Filter,
  Paintbrush,
  SlidersHorizontal,
  X,
} from 'lucide-react'
import { useId, useMemo, useState, type ReactNode } from 'react'
import {
  Button,
  Cell,
  Checkbox,
  CheckboxGroup,
  Column,
  ColumnResizer,
  Dialog,
  DialogTrigger,
  Heading,
  Input,
  Label,
  Popover,
  ResizableTableContainer,
  Row,
  SearchField,
  Table,
  TableBody,
  TableHeader,
  TextField,
  Toolbar as AriaToolbar,
  type CheckboxProps,
  type SortDescriptor,
} from 'react-aria-components'
import { cx } from '../cx.ts'
import {
  canScale,
  columnAlign,
  columnHeader,
  columnType,
  describeFilter,
  distinctValues,
  fitWidths,
  formatCell,
  MAX_CHECKLIST_VALUES,
  processRows,
  shownUnit,
  tableCsv,
  visibleColumns,
  type DataColumn,
} from '../tables/tableModel.ts'
import {
  DEFAULT_STYLE,
  type ColumnFilter,
  type ColumnFormat,
  type TableChange,
  type TableSettings,
} from '../tables/tableSettings.ts'
import componentStyles from './components.module.css'
import formStyles from './forms.module.css'
import menuStyles from './menus.module.css'
import { SegmentedFilter } from './SegmentedFilter.tsx'
import styles from './dataTable.module.css'

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
 * A checkbox in a table popover. Inside the table a checkbox would be claimed
 * as the row selection checkbox, so it opts out of that context.
 */
function ToolCheckbox(props: Omit<CheckboxProps, 'slot' | 'className'>) {
  return <Checkbox {...props} slot={null} className={formStyles.checkbox} />
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
  const filtered = processed.length !== rows.length
  const page = processed.slice(0, shownCount)
  const items: Item<Row>[] = page.map((row) => ({ id: rowKey(row), row }))
  const { style } = settings
  const widths = useMemo(
    () => fitWidths(rows, columns, settings),
    [rows, columns, settings],
  )
  const activeFilters = Object.entries(settings.filters).flatMap(
    ([columnId, filter]) => {
      const column = columns.find((candidate) => candidate.id === columnId)
      return column ? [{ column, filter }] : []
    },
  )
  const hiddenCount = columns.length - shownColumns.length

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
      <div className={styles.bar}>
        <span className={styles.count} aria-live="polite">
          {filtered
            ? `${processed.length.toLocaleString('en-US')} of ${rows.length.toLocaleString('en-US')} rows`
            : ''}
        </span>
        {activeFilters.length > 0 ? (
          <span className={styles.chips}>
            {activeFilters.map(({ column, filter }) => (
              <button
                key={column.id}
                type="button"
                className={styles.chip}
                aria-label={`Remove filter: ${column.header} ${describeFilter(filter, column.unit)}`}
                onClick={() =>
                  onChange({ kind: 'filter', column: column.id, filter: null })
                }
              >
                {column.header} {describeFilter(filter, column.unit)}
                <X size={12} aria-hidden="true" />
              </button>
            ))}
          </span>
        ) : null}
        <AriaToolbar
          aria-label={`Table tools: ${label}`}
          className={styles.tools}
        >
          <ColumnsTool
            label={label}
            columns={columns}
            settings={settings}
            hiddenCount={hiddenCount}
            onChange={onChange}
          />
          <FiltersTool
            label={label}
            filters={activeFilters}
            onChange={onChange}
          />
          {exportOptions && onExport ? (
            <Button
              className={cx(componentStyles.button, styles.tool)}
              aria-label={`Download ${label} as CSV`}
              onPress={exportCsv}
            >
              <Download size={14} aria-hidden="true" />
            </Button>
          ) : null}
          <StyleTool label={label} settings={settings} onChange={onChange} />
        </AriaToolbar>
      </div>

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
            onSortChange={(descriptor) => {
              const column = String(descriptor.column)
              // Clicking a header steps through ascending, descending, and
              // unsorted.
              const cleared =
                settings.sort?.column === column &&
                settings.sort.direction === 'descending'
              onChange({
                kind: 'sort',
                sort: cleared
                  ? null
                  : {
                      column,
                      direction:
                        settings.sort?.column === column
                          ? 'descending'
                          : 'ascending',
                    },
              })
            }}
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
                  {({ sortDirection }) => (
                    <ColumnHead
                      column={column}
                      rows={rows}
                      settings={settings}
                      sortDirection={sortDirection}
                      onChange={onChange}
                    />
                  )}
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

/** A column header: name, sort direction, the two widgets, and a resizer. */
function ColumnHead<Row>({
  column,
  rows,
  settings,
  sortDirection,
  onChange,
}: {
  column: DataColumn<Row>
  rows: Row[]
  settings: TableSettings
  sortDirection: 'ascending' | 'descending' | undefined
  onChange: (change: TableChange) => void
}) {
  const format = settings.formats[column.id]
  const header = columnHeader(column, format)
  const filtered = column.id in settings.filters
  const formatted = format !== undefined && Object.keys(format).length > 0
  if (column.action) {
    return <span className="visually-hidden">{column.header}</span>
  }
  return (
    <div className={styles.head}>
      <span className={styles.headLabel}>{header}</span>
      <span className={styles.columnTools}>
        {column.filterable !== false || column.sortable !== false ? (
          <ColumnFilterTool
            column={column}
            rows={rows}
            settings={settings}
            filtered={filtered}
            sortDirection={sortDirection}
            onChange={onChange}
          />
        ) : null}
        <ColumnFormatTool
          column={column}
          settings={settings}
          active={formatted}
          onChange={onChange}
        />
      </span>
      <ColumnResizer
        className={styles.resizer}
        aria-label={`Resize ${column.header}`}
      />
    </div>
  )
}

function ToolPopover({
  title,
  children,
}: {
  title: string
  children: ReactNode
}) {
  return (
    <Popover
      className={cx(menuStyles.popover, styles.popover)}
      placement="bottom end"
    >
      <Dialog className={styles.dialog} aria-label={title}>
        <Heading slot="title" className={styles.dialogTitle}>
          {title}
        </Heading>
        {children}
      </Dialog>
    </Popover>
  )
}

function ColumnFilterTool<Row>({
  column,
  rows,
  settings,
  filtered,
  sortDirection,
  onChange,
}: {
  column: DataColumn<Row>
  rows: Row[]
  settings: TableSettings
  filtered: boolean
  sortDirection: 'ascending' | 'descending' | undefined
  onChange: (change: TableChange) => void
}) {
  const sorted = settings.sort?.column === column.id
  const state = [
    filtered ? 'filtered' : null,
    sortDirection ? `sorted ${sortDirection}` : null,
  ].filter(Boolean)
  const SortArrow = sortDirection === 'descending' ? ArrowDown : ArrowUp
  const [open, setOpen] = useState(false)
  return (
    <DialogTrigger isOpen={open} onOpenChange={setOpen}>
      <Button
        className={cx(
          styles.columnTool,
          (filtered || sortDirection) && styles.active,
        )}
        aria-label={`Filter and sort ${column.header}${state.length ? ` (${state.join(', ')})` : ''}`}
      >
        <Filter
          size={12}
          aria-hidden="true"
          fill={filtered ? 'currentColor' : 'none'}
        />
        {sortDirection ? (
          <SortArrow
            className={styles.sortCorner}
            size={9}
            strokeWidth={3}
            aria-hidden="true"
          />
        ) : null}
      </Button>
      <ToolPopover title={`Filter and sort: ${column.header}`}>
        {column.sortable !== false ? (
          <SegmentedFilter
            aria-label={`Sort by ${column.header}`}
            segments={[
              { id: 'none', label: 'Unsorted' },
              { id: 'ascending', label: 'Ascending' },
              { id: 'descending', label: 'Descending' },
            ]}
            value={sorted && settings.sort ? settings.sort.direction : 'none'}
            onChange={(direction) =>
              onChange({
                kind: 'sort',
                sort:
                  direction === 'none'
                    ? null
                    : { column: column.id, direction },
              })
            }
          />
        ) : null}
        {column.filterable !== false ? (
          <FilterEditor
            // A new draft for each stored filter.
            key={JSON.stringify(settings.filters[column.id] ?? null)}
            column={column}
            rows={rows}
            filter={settings.filters[column.id] ?? null}
            format={settings.formats[column.id]}
            onChange={(change) => {
              // Applying or clearing a filter closes it, as in a spreadsheet.
              onChange(change)
              setOpen(false)
            }}
          />
        ) : null}
      </ToolPopover>
    </DialogTrigger>
  )
}

/** The filter of one column, drafted and then applied. */
function FilterEditor<Row>({
  column,
  rows,
  filter,
  format,
  onChange,
}: {
  column: DataColumn<Row>
  rows: Row[]
  filter: ColumnFilter | null
  format: ColumnFormat | undefined
  onChange: (change: TableChange) => void
}) {
  const numeric = columnType(column) === 'number'
  return numeric ? (
    <RangeFilterEditor
      column={column}
      filter={filter}
      format={format}
      onChange={onChange}
    />
  ) : (
    <ValueFilterEditor
      column={column}
      rows={rows}
      filter={filter}
      onChange={onChange}
    />
  )
}

function FilterActions({
  column,
  filter,
  invalid,
  errorId,
  onChange,
}: {
  column: { id: string }
  filter: ColumnFilter | null
  invalid: string | null
  errorId: string
  onChange: (change: TableChange) => void
}) {
  return (
    <>
      {invalid ? (
        <p id={errorId} className={formStyles.fieldError} role="alert">
          {invalid}
        </p>
      ) : null}
      <div className={styles.dialogActions}>
        <button
          type="submit"
          className={cx(componentStyles.button, componentStyles.primary)}
          aria-disabled={invalid ? true : undefined}
          aria-describedby={invalid ? errorId : undefined}
        >
          Apply filter
        </button>
        <button
          type="button"
          className={componentStyles.button}
          aria-disabled={filter ? undefined : true}
          title={filter ? undefined : 'This column has no filter.'}
          onClick={() => {
            if (filter) {
              onChange({ kind: 'filter', column: column.id, filter: null })
            }
          }}
        >
          Clear filter
        </button>
      </div>
    </>
  )
}

/**
 * Text columns: a search field over a checklist of the column's distinct
 * values. Applying with every value checked clears the filter; applying while
 * searching with every match checked keeps the rows that contain the search.
 */
function ValueFilterEditor<Row>({
  column,
  rows,
  filter,
  onChange,
}: {
  column: DataColumn<Row>
  rows: Row[]
  filter: ColumnFilter | null
  onChange: (change: TableChange) => void
}) {
  const options = useMemo(() => distinctValues(rows, column), [rows, column])
  const [search, setSearch] = useState(
    filter?.kind === 'text' ? filter.contains : '',
  )
  const [checked, setChecked] = useState<string[]>(
    filter?.kind === 'values'
      ? filter.values.filter((value) => options.includes(value))
      : options,
  )
  const errorId = useId()
  const term = search.trim().toLowerCase()
  const matches = term
    ? options.filter((option) => option.toLowerCase().includes(term))
    : options
  const listed = matches.slice(0, MAX_CHECKLIST_VALUES)
  const checkedMatches = matches.filter((option) => checked.includes(option))
  const allMatchesChecked = checkedMatches.length === matches.length

  const draft = (): ColumnFilter | null => {
    if (!term) {
      return allMatchesChecked ? null : { kind: 'values', values: checked }
    }
    return allMatchesChecked
      ? { kind: 'text', contains: search.trim() }
      : { kind: 'values', values: checkedMatches }
  }
  const pending = draft()
  const invalid =
    pending?.kind === 'values' && pending.values.length > MAX_CHECKLIST_VALUES
      ? `Check at most ${MAX_CHECKLIST_VALUES} values, or search to narrow the list.`
      : matches.length === 0
        ? 'No value matches the search.'
        : null

  return (
    <form
      className={styles.filterForm}
      onSubmit={(event) => {
        event.preventDefault()
        if (invalid) return
        onChange({ kind: 'filter', column: column.id, filter: pending })
      }}
    >
      <SearchField
        className={formStyles.field}
        value={search}
        onChange={setSearch}
        autoFocus
      >
        <Label className={styles.fieldLabel}>Search values</Label>
        <Input className={formStyles.input} maxLength={100} />
      </SearchField>
      <ToolCheckbox
        isSelected={allMatchesChecked && matches.length > 0}
        isIndeterminate={checkedMatches.length > 0 && !allMatchesChecked}
        onChange={(select) =>
          setChecked((current) =>
            select
              ? [...new Set([...current, ...matches])]
              : current.filter((value) => !matches.includes(value)),
          )
        }
      >
        {term ? 'Select all matches' : 'Select all'}
      </ToolCheckbox>
      <CheckboxGroup
        className={styles.values}
        value={checked.filter((value) => listed.includes(value))}
        onChange={(next) =>
          setChecked((current) => [
            ...current.filter((value) => !listed.includes(value)),
            ...next,
          ])
        }
        aria-label={`Show rows where ${column.header} is`}
      >
        {listed.map((option) => (
          <ToolCheckbox key={option} value={option}>
            {option || '(empty)'}
          </ToolCheckbox>
        ))}
      </CheckboxGroup>
      {matches.length > listed.length ? (
        <p className={componentStyles.muted}>
          Showing {listed.length} of {matches.length} values; search to find the
          rest.
        </p>
      ) : null}
      <FilterActions
        column={column}
        filter={filter}
        invalid={invalid}
        errorId={errorId}
        onChange={onChange}
      />
    </form>
  )
}

/** Number columns: an at-least and at-most range, in the unit shown. */
function RangeFilterEditor<Row>({
  column,
  filter,
  format,
  onChange,
}: {
  column: DataColumn<Row>
  filter: ColumnFilter | null
  format: ColumnFormat | undefined
  onChange: (change: TableChange) => void
}) {
  // Ranges are stored in the column's own unit and entered in the unit shown.
  const factor = format?.scale === 'kilo' && canScale(column) ? 1000 : 1
  const unit = shownUnit(column, format)
  const shown = (value: number | null) =>
    value === null ? '' : String(value / factor)
  const [min, setMin] = useState(
    filter?.kind === 'range' ? shown(filter.min) : '',
  )
  const [max, setMax] = useState(
    filter?.kind === 'range' ? shown(filter.max) : '',
  )
  const errorId = useId()
  const parse = (value: string) =>
    value.trim() === '' ? null : Number(value.replace(/,/g, ''))
  const lower = parse(min)
  const upper = parse(max)
  const invalid =
    (lower !== null && !Number.isFinite(lower)) ||
    (upper !== null && !Number.isFinite(upper))
      ? 'Enter numbers, or leave a bound empty.'
      : lower !== null && upper !== null && lower > upper
        ? 'The lower bound is above the upper bound.'
        : null

  return (
    <form
      className={styles.filterForm}
      onSubmit={(event) => {
        event.preventDefault()
        if (invalid) return
        onChange({
          kind: 'filter',
          column: column.id,
          filter:
            lower === null && upper === null
              ? null
              : {
                  kind: 'range',
                  min: lower === null ? null : lower * factor,
                  max: upper === null ? null : upper * factor,
                },
        })
      }}
    >
      <div className={styles.range}>
        <TextField
          className={formStyles.field}
          value={min}
          onChange={setMin}
          isInvalid={invalid !== null}
        >
          <Label className={styles.fieldLabel}>
            At least{unit ? ` (${unit})` : ''}
          </Label>
          <Input className={formStyles.input} inputMode="decimal" />
        </TextField>
        <TextField
          className={formStyles.field}
          value={max}
          onChange={setMax}
          isInvalid={invalid !== null}
        >
          <Label className={styles.fieldLabel}>
            At most{unit ? ` (${unit})` : ''}
          </Label>
          <Input className={formStyles.input} inputMode="decimal" />
        </TextField>
      </div>
      <FilterActions
        column={column}
        filter={filter}
        invalid={invalid}
        errorId={errorId}
        onChange={onChange}
      />
    </form>
  )
}

function ColumnFormatTool<Row>({
  column,
  settings,
  active,
  onChange,
}: {
  column: DataColumn<Row>
  settings: TableSettings
  active: boolean
  onChange: (change: TableChange) => void
}) {
  const format = settings.formats[column.id] ?? {}
  const numeric = columnType(column) === 'number'
  const set = (next: TableChange & { kind: 'format' }) => onChange(next)
  return (
    <DialogTrigger>
      <Button
        className={cx(styles.columnTool, active && styles.active)}
        aria-label={`Format ${column.header}`}
      >
        <SlidersHorizontal size={12} aria-hidden="true" />
      </Button>
      <ToolPopover title={`Format: ${column.header}`}>
        {numeric ? (
          <>
            <p className={styles.fieldLabel}>Decimals</p>
            <SegmentedFilter
              aria-label={`Decimals of ${column.header}`}
              segments={[
                { id: 'auto', label: 'Auto' },
                { id: '0', label: '0' },
                { id: '1', label: '1' },
                { id: '2', label: '2' },
                { id: '3', label: '3' },
              ]}
              value={
                format.decimals === undefined || format.decimals === null
                  ? 'auto'
                  : (String(format.decimals) as '0' | '1' | '2' | '3')
              }
              onChange={(value) =>
                set({
                  kind: 'format',
                  column: column.id,
                  format: { decimals: value === 'auto' ? null : Number(value) },
                })
              }
            />
            {canScale(column) ? (
              <>
                <p className={styles.fieldLabel}>Unit</p>
                <SegmentedFilter
                  aria-label={`Unit of ${column.header}`}
                  segments={[
                    { id: 'base', label: column.unit ?? '' },
                    {
                      id: 'kilo',
                      label: shownUnit(column, { scale: 'kilo' }) ?? '',
                    },
                  ]}
                  value={format.scale ?? 'base'}
                  onChange={(scale) =>
                    set({
                      kind: 'format',
                      column: column.id,
                      format: { scale },
                    })
                  }
                />
              </>
            ) : null}
            <ToolCheckbox
              isSelected={format.grouping ?? true}
              onChange={(grouping) =>
                set({ kind: 'format', column: column.id, format: { grouping } })
              }
            >
              Thousands separators
            </ToolCheckbox>
          </>
        ) : null}
        <p className={styles.fieldLabel}>Alignment</p>
        <SegmentedFilter
          aria-label={`Alignment of ${column.header}`}
          segments={[
            { id: 'start', label: 'Left' },
            { id: 'center', label: 'Center' },
            { id: 'end', label: 'Right' },
          ]}
          value={columnAlign(column, format)}
          onChange={(align) =>
            set({ kind: 'format', column: column.id, format: { align } })
          }
        />
        <div className={styles.dialogActions}>
          <button
            type="button"
            className={componentStyles.button}
            aria-disabled={active ? undefined : true}
            title={active ? undefined : 'The column uses its default format.'}
            onClick={() => {
              if (active) {
                onChange({
                  kind: 'format',
                  column: column.id,
                  format: {
                    decimals: null,
                    scale: null,
                    grouping: null,
                    align: null,
                  },
                })
              }
            }}
          >
            Reset format
          </button>
        </div>
      </ToolPopover>
    </DialogTrigger>
  )
}

function ColumnsTool<Row>({
  label,
  columns,
  settings,
  hiddenCount,
  onChange,
}: {
  label: string
  columns: DataColumn<Row>[]
  settings: TableSettings
  hiddenCount: number
  onChange: (change: TableChange) => void
}) {
  const shown = visibleColumns(columns, settings).map((column) => column.id)
  return (
    <DialogTrigger>
      <Button
        className={cx(
          componentStyles.button,
          styles.tool,
          hiddenCount > 0 && styles.active,
        )}
        aria-label={`Columns of ${label}${hiddenCount ? ` (${hiddenCount} hidden)` : ''}`}
      >
        <Columns3 size={14} aria-hidden="true" />
        {hiddenCount > 0 ? (
          <span className={styles.badge} aria-hidden="true">
            {hiddenCount}
          </span>
        ) : null}
      </Button>
      <ToolPopover title={`Columns: ${label}`}>
        <CheckboxGroup
          className={styles.values}
          aria-label="Shown columns"
          value={shown}
          onChange={(next) => {
            const nextSet = new Set(next)
            for (const column of columns) {
              const isShown = shown.includes(column.id)
              if (isShown !== nextSet.has(column.id)) {
                onChange({
                  kind: 'setHidden',
                  column: column.id,
                  hidden: isShown,
                })
              }
            }
          }}
        >
          {columns.map((column) => (
            <ToolCheckbox
              key={column.id}
              value={column.id}
              isDisabled={column.rowHeader || column.hideable === false}
            >
              {column.header}
              {column.rowHeader ? (
                <span className={componentStyles.muted}> (names each row)</span>
              ) : null}
            </ToolCheckbox>
          ))}
        </CheckboxGroup>
        <div className={styles.dialogActions}>
          <button
            type="button"
            className={componentStyles.button}
            aria-disabled={hiddenCount ? undefined : true}
            title={hiddenCount ? undefined : 'Every column is shown.'}
            onClick={() => {
              if (hiddenCount) onChange({ kind: 'showAllColumns' })
            }}
          >
            Show all columns
          </button>
        </div>
      </ToolPopover>
    </DialogTrigger>
  )
}

function FiltersTool<Row>({
  label,
  filters,
  onChange,
}: {
  label: string
  filters: { column: DataColumn<Row>; filter: ColumnFilter }[]
  onChange: (change: TableChange) => void
}) {
  return (
    <DialogTrigger>
      <Button
        className={cx(
          componentStyles.button,
          styles.tool,
          filters.length > 0 && styles.active,
        )}
        aria-label={`Filters of ${label}${filters.length ? ` (${filters.length} active)` : ''}`}
      >
        <Filter size={14} aria-hidden="true" />
        {filters.length > 0 ? (
          <span className={styles.badge} aria-hidden="true">
            {filters.length}
          </span>
        ) : null}
      </Button>
      <ToolPopover title={`Filters: ${label}`}>
        {filters.length === 0 ? (
          <p className={componentStyles.muted}>
            No filters. Use a column&rsquo;s filter button to add one.
          </p>
        ) : (
          <ul className={styles.filterList}>
            {filters.map(({ column, filter }) => (
              <li key={column.id}>
                <span>
                  {column.header} {describeFilter(filter, column.unit)}
                </span>
                <button
                  type="button"
                  className={componentStyles.button}
                  aria-label={`Remove filter: ${column.header} ${describeFilter(filter, column.unit)}`}
                  onClick={() =>
                    onChange({
                      kind: 'filter',
                      column: column.id,
                      filter: null,
                    })
                  }
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
        )}
        <div className={styles.dialogActions}>
          <button
            type="button"
            className={componentStyles.button}
            aria-disabled={filters.length ? undefined : true}
            title={filters.length ? undefined : 'No filters are set.'}
            onClick={() => {
              if (filters.length) onChange({ kind: 'clearFilters' })
            }}
          >
            Clear all filters
          </button>
        </div>
      </ToolPopover>
    </DialogTrigger>
  )
}

function StyleTool({
  label,
  settings,
  onChange,
}: {
  label: string
  settings: TableSettings
  onChange: (change: TableChange) => void
}) {
  const { style } = settings
  const styled = JSON.stringify(style) !== JSON.stringify(DEFAULT_STYLE)
  return (
    <DialogTrigger>
      <Button
        className={cx(
          componentStyles.button,
          styles.tool,
          styled && styles.active,
        )}
        aria-label={`Style of ${label}`}
      >
        <Paintbrush size={14} aria-hidden="true" />
      </Button>
      <ToolPopover title={`Style: ${label}`}>
        <p className={styles.fieldLabel}>Rows</p>
        <SegmentedFilter
          aria-label="Row density"
          segments={[
            { id: 'compact', label: 'Compact' },
            { id: 'comfortable', label: 'Comfortable' },
          ]}
          value={style.density}
          onChange={(density) =>
            onChange({ kind: 'style', style: { density } })
          }
        />
        <p className={styles.fieldLabel}>Column widths</p>
        <SegmentedFilter
          aria-label="Column widths"
          segments={[
            { id: 'default', label: 'Default' },
            { id: 'fit', label: 'Fit content' },
            { id: 'even', label: 'Even' },
          ]}
          value={style.widths}
          onChange={(widths) => onChange({ kind: 'style', style: { widths } })}
        />
        <div className={styles.values}>
          <ToolCheckbox
            isSelected={style.shaded}
            onChange={(shaded) =>
              onChange({ kind: 'style', style: { shaded } })
            }
          >
            Shade alternate rows
          </ToolCheckbox>
          <ToolCheckbox
            isSelected={style.wrap}
            onChange={(wrap) => onChange({ kind: 'style', style: { wrap } })}
          >
            Wrap long text
          </ToolCheckbox>
          <ToolCheckbox
            isSelected={style.freezeHeader}
            onChange={(freezeHeader) =>
              onChange({ kind: 'style', style: { freezeHeader } })
            }
          >
            Freeze the header row
          </ToolCheckbox>
          <ToolCheckbox
            isSelected={style.freezeFirst}
            onChange={(freezeFirst) =>
              onChange({ kind: 'style', style: { freezeFirst } })
            }
          >
            Freeze the first column
          </ToolCheckbox>
        </div>
        <div className={styles.dialogActions}>
          <button
            type="button"
            className={componentStyles.button}
            onClick={() => onChange({ kind: 'reset' })}
          >
            Reset table
          </button>
        </div>
      </ToolPopover>
    </DialogTrigger>
  )
}
