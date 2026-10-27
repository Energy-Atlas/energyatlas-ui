import type { ReactNode } from 'react'
import { csvCommentLine, csvField } from '../csv.ts'
import type {
  ColumnFilter,
  ColumnFormat,
  TableSettings,
} from './tableSettings.ts'

// The row model behind DataTable (decision 0027): which columns show, which
// rows pass the filters and in what order, how a value reads, and what an
// export contains. Pure, so the rules are unit-tested apart from React.

export type ColumnType = 'text' | 'number' | 'enum' | 'identifier'

export type DataColumn<Row> = {
  id: string
  /** The column's name, without its unit. */
  header: string
  /** The value that is sorted, filtered, formatted, and exported. */
  value: (row: Row) => string | number | null
  /** Enum columns filter by a checklist of values; text by "contains". */
  type?: ColumnType
  /** Shown after the header, such as "kWh"; kWh, kW, and kVA can scale. */
  unit?: string
  /** Default digits after the decimal point for numbers. */
  decimals?: number
  /** False turns thousands separators off by default, as for years. */
  grouping?: boolean
  /** Custom cell content, given the formatted text (buttons, badges). */
  render?: (row: Row, text: string) => ReactNode
  /** Names the row for assistive technology; it cannot be hidden. */
  rowHeader?: boolean
  hideable?: boolean
  sortable?: boolean
  filterable?: boolean
  /** Default width in pixels. */
  width?: number
  /** Text for a missing value. */
  empty?: string
  /** Long text (messages, explanations) wraps instead of being cut short. */
  wrap?: boolean
  /**
   * Row actions (buttons): the header is read by assistive technology only,
   * and the column has no widgets, no sort, and no place in exports.
   */
  action?: boolean
}

const SCALED_UNITS: Record<string, string> = {
  kWh: 'MWh',
  'kWh/yr': 'MWh/yr',
  kW: 'MW',
  kVA: 'MVA',
}

export function canScale<Row>(column: DataColumn<Row>): boolean {
  return column.unit !== undefined && column.unit in SCALED_UNITS
}

export function columnType<Row>(column: DataColumn<Row>): ColumnType {
  return column.type ?? 'text'
}

export function isNumeric<Row>(column: DataColumn<Row>): boolean {
  return columnType(column) === 'number'
}

function scaled(format: ColumnFormat | undefined): boolean {
  return format?.scale === 'kilo'
}

/** The unit shown for the column under its format. */
export function shownUnit<Row>(
  column: DataColumn<Row>,
  format: ColumnFormat | undefined,
): string | undefined {
  if (!column.unit) return undefined
  return scaled(format) && column.unit in SCALED_UNITS
    ? SCALED_UNITS[column.unit]
    : column.unit
}

/** The header with its unit, such as "Annual demand (MWh)". */
export function columnHeader<Row>(
  column: DataColumn<Row>,
  format?: ColumnFormat,
): string {
  const unit = shownUnit(column, format)
  return unit ? `${column.header} (${unit})` : column.header
}

export function columnAlign<Row>(
  column: DataColumn<Row>,
  format: ColumnFormat | undefined,
): 'start' | 'center' | 'end' {
  return format?.align ?? (isNumeric(column) ? 'end' : 'start')
}

/** How a value reads in its cell. */
export function formatCell<Row>(
  value: string | number | null,
  column: DataColumn<Row>,
  format?: ColumnFormat,
): string {
  if (value === null || value === '') return column.empty ?? ''
  if (typeof value !== 'number') return value
  const isScaled = scaled(format) && canScale(column)
  const shown = isScaled ? value / 1000 : value
  const fixed = format?.decimals ?? null
  const digits = fixed ?? (isScaled ? 1 : (column.decimals ?? 0))
  return shown.toLocaleString('en-US', {
    minimumFractionDigits: fixed ?? 0,
    maximumFractionDigits: digits,
    useGrouping: format?.grouping ?? column.grouping ?? true,
  })
}

export function visibleColumns<Row>(
  columns: DataColumn<Row>[],
  settings: TableSettings,
): DataColumn<Row>[] {
  const hidden = new Set(settings.hidden)
  return columns.filter(
    (column) =>
      column.rowHeader || column.hideable === false || !hidden.has(column.id),
  )
}

export function matchesFilter(
  value: string | number | null,
  filter: ColumnFilter,
): boolean {
  switch (filter.kind) {
    case 'text':
      return String(value ?? '')
        .toLowerCase()
        .includes(filter.contains.trim().toLowerCase())
    case 'values':
      return filter.values.includes(String(value ?? ''))
    case 'range':
      if (typeof value !== 'number') return false
      return (
        (filter.min === null || value >= filter.min) &&
        (filter.max === null || value <= filter.max)
      )
  }
}

function compareValues(
  a: string | number | null,
  b: string | number | null,
): number {
  // Missing values sort last in either direction.
  if (a === null || a === '') return b === null || b === '' ? 0 : 1
  if (b === null || b === '') return -1
  if (typeof a === 'number' && typeof b === 'number') return a - b
  return String(a).localeCompare(String(b), 'en', { numeric: true })
}

/** Rows that pass every filter, in the chosen order. */
export function processRows<Row>(
  rows: Row[],
  columns: DataColumn<Row>[],
  settings: TableSettings,
): Row[] {
  const byId = new Map(columns.map((column) => [column.id, column]))
  const filters = Object.entries(settings.filters).flatMap(([id, filter]) => {
    const column = byId.get(id)
    return column ? [{ column, filter }] : []
  })
  const kept = filters.length
    ? rows.filter((row) =>
        filters.every(({ column, filter }) =>
          matchesFilter(column.value(row), filter),
        ),
      )
    : [...rows]
  const sortColumn = settings.sort ? byId.get(settings.sort.column) : undefined
  if (!sortColumn || !settings.sort) return kept
  const direction = settings.sort.direction === 'ascending' ? 1 : -1
  return kept
    .map((row, index) => ({ row, index, value: sortColumn.value(row) }))
    .sort((a, b) => {
      const missingA = a.value === null || a.value === ''
      const missingB = b.value === null || b.value === ''
      if (missingA !== missingB) return missingA ? 1 : -1
      return compareValues(a.value, b.value) * direction || a.index - b.index
    })
    .map((entry) => entry.row)
}

/**
 * Rows whose shown text, in any shown column, contains the search, ignoring
 * case: the Table page's search field.
 */
export function searchRows<Row>(
  rows: Row[],
  columns: DataColumn<Row>[],
  settings: TableSettings,
  search: string,
): Row[] {
  const term = search.trim().toLowerCase()
  if (!term) return rows
  const shown = visibleColumns(columns, settings).filter(
    (column) => !column.action,
  )
  return rows.filter((row) =>
    shown.some((column) =>
      formatCell(column.value(row), column, settings.formats[column.id])
        .toLowerCase()
        .includes(term),
    ),
  )
}

/** Most values a checklist filter lists; more and the column filters by text. */
export const MAX_CHECKLIST_VALUES = 200

/** Distinct values of an enum column, for its checklist filter. */
export function distinctValues<Row>(
  rows: Row[],
  column: DataColumn<Row>,
): string[] {
  const values = new Set<string>()
  for (const row of rows) values.add(String(column.value(row) ?? ''))
  return [...values].sort((a, b) => a.localeCompare(b, 'en', { numeric: true }))
}

/**
 * A filter in words, such as "contains “bay”" or "from 10,000 to 20,000 kWh".
 * Ranges are stored, and described, in the column's own unit.
 */
export function describeFilter(filter: ColumnFilter, unit?: string): string {
  const number = (value: number) =>
    `${value.toLocaleString('en-US')}${unit ? ` ${unit}` : ''}`
  switch (filter.kind) {
    case 'text':
      return `contains “${filter.contains.trim()}”`
    case 'values':
      return filter.values.length === 0
        ? 'no values'
        : `is ${filter.values.map((value) => value || '(empty)').join(' or ')}`
    case 'range':
      if (filter.min !== null && filter.max !== null) {
        return `from ${number(filter.min)} to ${number(filter.max)}`
      }
      return filter.min !== null
        ? `at least ${number(filter.min)}`
        : `at most ${number(filter.max ?? 0)}`
  }
}

/** An estimate where text cannot be measured (tests, before first paint). */
const CHAR_PX = 6.5
/** Cell padding (0.5rem each side), the cell's rule, and a pixel to spare. */
const CELL_PADDING_PX = 20
/** The two column widgets in a header (1.25rem each) and their gaps. */
const HEADER_WIDGETS_PX = 46
const MIN_WIDTH_PX = 56
const MAX_WIDTH_PX = 360

const ESTIMATE = {
  cell: (text: string) => text.length * CHAR_PX,
  header: (text: string) => text.length * CHAR_PX,
}

/**
 * Widths that fit each column: its widest cell text, or its header label
 * with the header's widgets, whichever is wider, plus padding. Text is
 * measured in the table's fonts when `measure` is given (decision 0028);
 * the widgets count only for the header, which holds them.
 */
export function fitWidths<Row>(
  rows: Row[],
  columns: DataColumn<Row>[],
  settings: TableSettings,
  measure: {
    cell: (text: string) => number
    header: (text: string) => number
  } | null = null,
): Record<string, number> {
  const text = measure ?? ESTIMATE
  const sample = rows.slice(0, 200)
  const widths: Record<string, number> = {}
  for (const column of columns) {
    const format = settings.formats[column.id]
    const header = columnHeader(column, format)
    let widest = text.header(header) + (column.action ? 0 : HEADER_WIDGETS_PX)
    for (const row of sample) {
      widest = Math.max(
        widest,
        text.cell(formatCell(column.value(row), column, format)),
      )
    }
    widths[column.id] = Math.round(
      Math.min(MAX_WIDTH_PX, Math.max(MIN_WIDTH_PX, widest + CELL_PADDING_PX)),
    )
  }
  return widths
}

/** A machine-readable unit for a CSV column name, such as "kWh" or "m2". */
function csvUnit(unit: string): string {
  return unit.replace('²', '2').replace('³', '3')
}

/**
 * A CSV of the table as the reader sees it: identifying comment lines, the
 * shown columns with units in their names, and every row that passes the
 * filters (not only the rows on screen), in the chosen order. Values are
 * written unformatted; formula-like text is neutralised.
 */
export function tableCsv<Row>({
  label,
  columns,
  rows,
  total,
  settings,
  exportedAt,
  context = [],
  search = '',
}: {
  label: string
  columns: DataColumn<Row>[]
  rows: Row[]
  total: number
  settings: TableSettings
  exportedAt: string
  context?: string[]
  /** The search the rows passed, if any. */
  search?: string
}): string {
  const shown = visibleColumns(columns, settings).filter(
    (column) => !column.action,
  )
  const byId = new Map(columns.map((column) => [column.id, column]))
  const filters = Object.entries(settings.filters)
    .filter(([id]) => byId.has(id))
    .map(
      ([id, filter]) =>
        `${byId.get(id)?.header} ${describeFilter(filter, byId.get(id)?.unit)}`,
    )
  const sortColumn = settings.sort ? byId.get(settings.sort.column) : undefined
  const lines = [
    '# EnergyAtlas UI demo export (synthetic data)',
    csvCommentLine(`# table: ${label}`),
    ...context.map((line) => csvCommentLine(`# ${line}`)),
    `# rows: ${rows.length} of ${total}`,
    ...(search.trim() ? [csvCommentLine(`# search: ${search.trim()}`)] : []),
    ...(filters.length
      ? [csvCommentLine(`# filters: ${filters.join('; ')}`)]
      : []),
    ...(sortColumn && settings.sort
      ? [
          csvCommentLine(
            `# sorted by: ${sortColumn.header}, ${settings.sort.direction}`,
          ),
        ]
      : []),
    `# exported at: ${exportedAt}`,
    shown
      .map((column) =>
        csvField(
          column.unit
            ? `${column.header}[${csvUnit(column.unit)}]`
            : column.header,
        ),
      )
      .join(','),
    ...rows.map((row) =>
      shown.map((column) => csvField(column.value(row))).join(','),
    ),
  ]
  return `${lines.join('\n')}\n`
}
