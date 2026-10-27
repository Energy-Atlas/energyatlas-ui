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
import { useId, useMemo, useRef, useState, type ReactNode } from 'react'
import {
  Button,
  Checkbox,
  CheckboxGroup,
  Dialog,
  DialogTrigger,
  Heading,
  Input,
  Label,
  Popover,
  SearchField,
  TextField,
  Toolbar as AriaToolbar,
  type CheckboxProps,
} from 'react-aria-components'
import { cx } from '../cx.ts'
import {
  canScale,
  columnAlign,
  columnType,
  describeFilter,
  distinctValues,
  MAX_CHECKLIST_VALUES,
  shownUnit,
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

// The tools of the shared table contract (decision 0027), used by both
// renderers: the table bar (row count, filter chips, and the Columns,
// Filters, Download, and Style tools) and the two widgets of each column.

/**
 * A checkbox in a table popover. Inside the table a checkbox would be claimed
 * as the row selection checkbox, so it opts out of that context.
 */
export function ToolCheckbox(props: Omit<CheckboxProps, 'slot' | 'className'>) {
  return <Checkbox {...props} slot={null} className={formStyles.checkbox} />
}

/**
 * The bar above a table: how many rows pass the filters, a removable chip per
 * filter, and the table tools. `start` leads the bar, such as a search field.
 */
export function TableBar<Row>({
  label,
  columns,
  settings,
  total,
  shown,
  onChange,
  onExport,
  fixedStyle,
  start,
  className,
}: {
  label: string
  columns: DataColumn<Row>[]
  settings: TableSettings
  /** Rows before filtering. */
  total: number
  /** Rows that pass the filters. */
  shown: number
  onChange: (change: TableChange) => void
  /** Downloads the table as CSV; null leaves the Download tool out. */
  onExport: (() => void) | null
  fixedStyle?: FixedStyle
  start?: ReactNode
  className?: string
}) {
  const activeFilters = Object.entries(settings.filters).flatMap(
    ([columnId, filter]) => {
      const column = columns.find((candidate) => candidate.id === columnId)
      return column ? [{ column, filter }] : []
    },
  )
  const hiddenCount = columns.length - visibleColumns(columns, settings).length
  return (
    <div className={cx(styles.bar, className)}>
      {start}
      <span className={styles.count} aria-live="polite">
        {shown !== total
          ? `${shown.toLocaleString('en-US')} of ${total.toLocaleString('en-US')} rows`
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
        {onExport ? (
          <Button
            className={cx(componentStyles.button, styles.tool)}
            aria-label={`Download ${label} as CSV`}
            onPress={onExport}
          >
            <Download size={14} aria-hidden="true" />
          </Button>
        ) : null}
        <StyleTool
          label={label}
          settings={settings}
          fixedStyle={fixedStyle}
          onChange={onChange}
        />
      </AriaToolbar>
    </div>
  )
}

/**
 * Style options a renderer settles itself, each with the reason shown in
 * place of the option; AG Grid always keeps its header row in place.
 */
export type FixedStyle = { freezeHeader?: string }

/** A column's two widgets: filter and sort, and format. */
export function ColumnTools<Row>({
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
  const format = settings.formats[column.id]
  const sortDirection =
    settings.sort?.column === column.id ? settings.sort.direction : undefined
  return (
    <span className={styles.columnTools}>
      {column.filterable !== false || column.sortable !== false ? (
        <ColumnFilterTool
          column={column}
          rows={rows}
          settings={settings}
          filtered={column.id in settings.filters}
          sortDirection={sortDirection}
          onChange={onChange}
        />
      ) : null}
      <ColumnFormatTool
        column={column}
        settings={settings}
        active={format !== undefined && Object.keys(format).length > 0}
        onChange={onChange}
      />
    </span>
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
  const formRef = useRef<HTMLFormElement>(null)
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
      ref={formRef}
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
        // The search field keeps Enter to itself; Enter applies the filter.
        onSubmit={() => formRef.current?.requestSubmit()}
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
              isSelected={format.grouping ?? column.grouping ?? true}
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
  fixedStyle = {},
  onChange,
}: {
  label: string
  settings: TableSettings
  fixedStyle?: FixedStyle
  onChange: (change: TableChange) => void
}) {
  const fixedHeaderId = useId()
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
          {fixedStyle.freezeHeader ? (
            <>
              <ToolCheckbox
                isSelected
                isDisabled
                aria-describedby={fixedHeaderId}
              >
                Freeze the header row
              </ToolCheckbox>
              <p id={fixedHeaderId} className={componentStyles.muted}>
                {fixedStyle.freezeHeader}
              </p>
            </>
          ) : (
            <ToolCheckbox
              isSelected={style.freezeHeader}
              onChange={(freezeHeader) =>
                onChange({ kind: 'style', style: { freezeHeader } })
              }
            >
              Freeze the header row
            </ToolCheckbox>
          )}
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
