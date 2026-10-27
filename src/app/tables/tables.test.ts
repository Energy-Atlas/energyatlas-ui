import { afterEach, describe, expect, test } from 'vitest'
import { createWorkbench } from '../../domain/workbench.ts'
import { csvCommentLine, csvField } from '../csv.ts'
import { createViewStore } from '../view/viewStore.ts'
import { describeTableChange, tableChangeIssue } from './tableChange.ts'
import {
  columnHeader,
  describeFilter,
  fitWidths,
  formatCell,
  processRows,
  searchRows,
  tableCsv,
  visibleColumns,
  type DataColumn,
} from './tableModel.ts'
import { registerTable, type RegisteredTable } from './tableRegistry.ts'
import {
  applyTableChange,
  defaultTableSettings,
  isCustomised,
  nextHeaderSort,
  parseStoredTables,
  tablesDiffer,
} from './tableSettings.ts'

type Building = { id: string; use: string; kwh: number | null; name: string }

const ROWS: Building[] = [
  { id: 'B2', use: 'Office', kwh: 2_500, name: 'Beacon' },
  { id: 'B10', use: 'Retail', kwh: null, name: '=cmd' },
  { id: 'B1', use: 'Office', kwh: 12_000, name: 'Arlington' },
]

const COLUMNS: DataColumn<Building>[] = [
  { id: 'id', header: 'Building', value: (row) => row.id, rowHeader: true },
  { id: 'use', header: 'Use', value: (row) => row.use, type: 'enum' },
  {
    id: 'kwh',
    header: 'Demand',
    value: (row) => row.kwh,
    type: 'number',
    unit: 'kWh',
  },
  { id: 'name', header: 'Name', value: (row) => row.name },
]

const REGISTERED: RegisteredTable = {
  label: 'Buildings',
  columns: [
    {
      id: 'id',
      header: 'Building',
      type: 'text',
      hideable: false,
      scalable: false,
      sortable: true,
      filterable: true,
    },
    {
      id: 'use',
      header: 'Use',
      type: 'enum',
      hideable: true,
      scalable: false,
      sortable: true,
      filterable: true,
    },
    {
      id: 'kwh',
      header: 'Demand',
      type: 'number',
      hideable: true,
      scalable: true,
      unit: 'kWh',
      sortable: true,
      filterable: true,
    },
  ],
}

describe('table settings', () => {
  test('changes accumulate without touching the previous settings', () => {
    const start = defaultTableSettings()
    const hidden = applyTableChange(start, {
      kind: 'setHidden',
      column: 'use',
      hidden: true,
    })
    expect(start.hidden).toEqual([])
    expect(hidden.hidden).toEqual(['use'])
    expect(isCustomised(start)).toBe(false)
    expect(isCustomised(hidden)).toBe(true)
    const shown = applyTableChange(hidden, { kind: 'showAllColumns' })
    expect(shown.hidden).toEqual([])
  })

  test('an empty filter removes the column filter', () => {
    const filtered = applyTableChange(defaultTableSettings(), {
      kind: 'filter',
      column: 'name',
      filter: { kind: 'text', contains: 'bea' },
    })
    expect(filtered.filters.name).toBeDefined()
    const cleared = applyTableChange(filtered, {
      kind: 'filter',
      column: 'name',
      filter: { kind: 'text', contains: '  ' },
    })
    expect(cleared.filters).toEqual({})
  })

  test('undefined format entries return a column to its default', () => {
    const formatted = applyTableChange(defaultTableSettings(), {
      kind: 'format',
      column: 'kwh',
      format: { scale: 'kilo', decimals: 2 },
    })
    expect(formatted.formats.kwh).toEqual({ scale: 'kilo', decimals: 2 })
    const reset = applyTableChange(formatted, {
      kind: 'format',
      column: 'kwh',
      format: { scale: undefined, decimals: undefined },
    })
    expect(reset.formats).toEqual({})
  })

  test('stored settings that no longer parse are dropped one table at a time', () => {
    const good = defaultTableSettings()
    expect(parseStoredTables({ ok: good, broken: { hidden: 'nope' } })).toEqual(
      { ok: good },
    )
    expect(parseStoredTables('garbage')).toEqual({})
  })
})

describe('fitted column widths', () => {
  // One pixel per character, so the arithmetic is easy to read.
  const measure = {
    cell: (text: string) => text.length,
    header: (text: string) => text.length,
  }

  test('fit the widest text plus padding; header widgets count for headers only', () => {
    const rows = [
      { id: 'B1', use: 'x'.repeat(200), kwh: 1, name: 'A' },
    ] satisfies Building[]
    const widths = fitWidths(rows, COLUMNS, defaultTableSettings(), measure)
    // A long cell sets the width: its text and the padding, no widgets.
    expect(widths.use).toBe(200 + 20)
    // A short column is its header with the two widgets, then the minimum.
    expect(widths.id).toBe(Math.max(56, 'Building'.length + 46 + 20))
  })

  test('stay within limits', () => {
    const rows = [
      { id: 'B1', use: 'x'.repeat(1_000), kwh: 1, name: '' },
    ] satisfies Building[]
    const widths = fitWidths(rows, COLUMNS, defaultTableSettings(), measure)
    expect(widths.use).toBe(360)
    expect(widths.name).toBeGreaterThanOrEqual(56)
  })
})

describe('table model', () => {
  test('filters, then sorts with missing values last', () => {
    const settings = applyTableChange(
      applyTableChange(defaultTableSettings(), {
        kind: 'sort',
        sort: { column: 'kwh', direction: 'descending' },
      }),
      {
        kind: 'filter',
        column: 'use',
        filter: { kind: 'values', values: ['Office', 'Retail'] },
      },
    )
    expect(processRows(ROWS, COLUMNS, settings).map((row) => row.id)).toEqual([
      'B1',
      'B2',
      'B10',
    ])
    const ascending = applyTableChange(settings, {
      kind: 'sort',
      sort: { column: 'kwh', direction: 'ascending' },
    })
    expect(processRows(ROWS, COLUMNS, ascending).map((row) => row.id)).toEqual([
      'B2',
      'B1',
      'B10',
    ])
  })

  test('text sorts numerically within identifiers', () => {
    const settings = applyTableChange(defaultTableSettings(), {
      kind: 'sort',
      sort: { column: 'id', direction: 'ascending' },
    })
    expect(processRows(ROWS, COLUMNS, settings).map((row) => row.id)).toEqual([
      'B1',
      'B2',
      'B10',
    ])
  })

  test('range and text filters', () => {
    const range = applyTableChange(defaultTableSettings(), {
      kind: 'filter',
      column: 'kwh',
      filter: { kind: 'range', min: 3_000, max: null },
    })
    expect(processRows(ROWS, COLUMNS, range).map((row) => row.id)).toEqual([
      'B1',
    ])
    const text = applyTableChange(defaultTableSettings(), {
      kind: 'filter',
      column: 'name',
      filter: { kind: 'text', contains: 'ARL' },
    })
    expect(processRows(ROWS, COLUMNS, text).map((row) => row.id)).toEqual([
      'B1',
    ])
    expect(describeFilter({ kind: 'range', min: 3_000, max: null })).toBe(
      'at least 3,000',
    )
  })

  test('formats scale kWh to MWh and keep chosen decimals', () => {
    const kwh = COLUMNS[2]!
    expect(formatCell(12_000, kwh)).toBe('12,000')
    expect(formatCell(12_345, kwh, { scale: 'kilo' })).toBe('12.3')
    expect(formatCell(12_000, kwh, { decimals: 2, grouping: false })).toBe(
      '12000.00',
    )
    expect(columnHeader(kwh, { scale: 'kilo' })).toBe('Demand (MWh)')
    expect(formatCell(null, { ...kwh, empty: 'No data' })).toBe('No data')
  })

  test('the row-naming column stays shown', () => {
    const settings = { ...defaultTableSettings(), hidden: ['id', 'use'] }
    expect(
      visibleColumns(COLUMNS, settings).map((column) => column.id),
    ).toEqual(['id', 'kwh', 'name'])
  })

  test('the CSV names its view, keeps raw values, and neutralises formulas', () => {
    const settings = applyTableChange(
      { ...defaultTableSettings(), hidden: ['use'] },
      {
        kind: 'filter',
        column: 'kwh',
        filter: { kind: 'range', min: null, max: 5_000 },
      },
    )
    const rows = processRows(ROWS, COLUMNS, settings)
    const csv = tableCsv({
      label: 'Buildings',
      columns: COLUMNS,
      rows,
      total: ROWS.length,
      settings,
      exportedAt: '2026-10-26T00:00:00Z',
      context: ['project: Demo\nInjected'],
    })
    const lines = csv.trim().split('\n')
    expect(lines).toContain('# project: Demo Injected')
    expect(lines).toContain('# rows: 1 of 3')
    expect(lines).toContain('# filters: Demand at most 5,000 kWh')
    expect(lines).toContain('Building,Demand[kWh],Name')
    expect(lines).toContain('B2,2500,Beacon')
    const formula = tableCsv({
      label: 'Buildings',
      columns: COLUMNS,
      rows: [ROWS[1]!],
      total: 3,
      settings: defaultTableSettings(),
      exportedAt: 'now',
    })
    expect(formula).toContain("B10,Retail,,'=cmd")
  })
})

describe('the Table page grid (step 3)', () => {
  test('a header click steps ascending, descending, unsorted', () => {
    const ascending = nextHeaderSort(null, 'use')
    expect(ascending).toEqual({ column: 'use', direction: 'ascending' })
    const descending = nextHeaderSort(ascending, 'use')
    expect(descending).toEqual({ column: 'use', direction: 'descending' })
    expect(nextHeaderSort(descending, 'use')).toBeNull()
    // Another column starts over at ascending.
    expect(nextHeaderSort(descending, 'kwh')).toEqual({
      column: 'kwh',
      direction: 'ascending',
    })
  })

  test('the search matches shown text in shown columns, ignoring case', () => {
    const settings = defaultTableSettings()
    expect(searchRows(ROWS, COLUMNS, settings, ' beacon ')).toEqual([ROWS[0]])
    // Numbers match as they read, with separators.
    expect(searchRows(ROWS, COLUMNS, settings, '12,000')).toEqual([ROWS[2]])
    // A hidden column is not searched.
    const hidden = applyTableChange(settings, {
      kind: 'setHidden',
      column: 'name',
      hidden: true,
    })
    expect(searchRows(ROWS, COLUMNS, hidden, 'beacon')).toEqual([])
    expect(searchRows(ROWS, COLUMNS, settings, '')).toBe(ROWS)
  })

  test('the CSV names the search the rows passed', () => {
    const csv = tableCsv({
      label: 'Buildings',
      columns: COLUMNS,
      rows: [ROWS[0]!],
      total: 3,
      settings: defaultTableSettings(),
      exportedAt: 'now',
      search: 'beacon',
    })
    expect(csv).toContain('# rows: 1 of 3\n# search: beacon\n')
  })

  test('a column can turn thousands separators off by default', () => {
    const year: DataColumn<{ year: number }> = {
      id: 'year',
      header: 'Year built',
      value: (row) => row.year,
      type: 'number',
      grouping: false,
    }
    expect(formatCell(1967, year)).toBe('1967')
    expect(formatCell(1967, year, { grouping: true })).toBe('1,967')
  })
})

describe('review fixes', () => {
  test('a format entry set to null returns to the default', () => {
    const formatted = applyTableChange(defaultTableSettings(), {
      kind: 'format',
      column: 'kwh',
      format: { decimals: 2 },
    })
    const auto = applyTableChange(formatted, {
      kind: 'format',
      column: 'kwh',
      format: { decimals: null },
    })
    expect(auto.formats).toEqual({})
  })

  test('ranges are described in the column unit', () => {
    expect(
      describeFilter({ kind: 'range', min: 5_000, max: null }, 'kWh'),
    ).toBe('at least 5,000 kWh')
  })

  test('comment lines and values cannot split into formula cells', () => {
    expect(csvCommentLine('# project: x, =HYPERLINK("a")')).toBe(
      "# project: x, '=HYPERLINK('a')",
    )
    expect(csvField('a\rb')).toBe('"a\rb"')
  })

  test('the agent cannot sort an unsortable column or text-filter numbers', () => {
    const table: RegisteredTable = {
      ...REGISTERED,
      columns: REGISTERED.columns.map((column) =>
        column.id === 'use' ? { ...column, sortable: false } : column,
      ),
    }
    expect(
      tableChangeIssue(table, {
        kind: 'sort',
        sort: { column: 'use', direction: 'ascending' },
      }),
    ).toEqual(expect.objectContaining({ path: 'change.sort.column' }))
    expect(
      tableChangeIssue(table, {
        kind: 'filter',
        column: 'kwh',
        filter: { kind: 'text', contains: '5' },
      })?.message,
    ).toContain('filter it by range')
  })
})

describe('table changes', () => {
  test('unknown columns and wrong filter kinds are explained', () => {
    expect(
      tableChangeIssue(REGISTERED, {
        kind: 'sort',
        sort: { column: 'floors', direction: 'ascending' },
      })?.message,
    ).toContain('has no column "floors"')
    expect(
      tableChangeIssue(REGISTERED, {
        kind: 'setHidden',
        column: 'id',
        hidden: true,
      })?.message,
    ).toContain('stays shown')
    expect(
      tableChangeIssue(REGISTERED, {
        kind: 'filter',
        column: 'use',
        filter: { kind: 'range', min: 1, max: 2 },
      })?.message,
    ).toContain('not a number column')
    expect(
      tableChangeIssue(REGISTERED, {
        kind: 'format',
        column: 'use',
        format: { scale: 'kilo' },
      })?.message,
    ).toContain('no unit that scales')
    expect(
      tableChangeIssue(REGISTERED, {
        kind: 'filter',
        column: 'kwh',
        filter: { kind: 'range', min: 5, max: 1 },
      })?.message,
    ).toContain('lower bound')
  })

  test('changes are described for the operation log', () => {
    expect(
      describeTableChange(REGISTERED, {
        kind: 'sort',
        sort: { column: 'kwh', direction: 'descending' },
      }),
    ).toBe('Sorted "Buildings" by Demand, descending.')
    expect(
      describeTableChange(REGISTERED, {
        kind: 'style',
        style: { shaded: true, widths: 'fit' },
      }),
    ).toBe(
      'Styled "Buildings": shaded alternate rows, columns fitted to content.',
    )
  })
})

describe('the table.change view operation', () => {
  let unregister: (() => void) | null = null
  afterEach(() => {
    unregister?.()
    unregister = null
  })

  test('rejects a table that is not on screen and names the open ones', () => {
    const view = createViewStore(createWorkbench())
    unregister = registerTable('test.buildings', REGISTERED)
    const result = view.execute({
      type: 'table.change',
      input: { tableId: 'missing', change: { kind: 'reset' } },
    })
    expect(result.outcome.status).toBe('rejected')
    expect(JSON.stringify(result.outcome)).toContain('test.buildings')
  })

  test('a project reset keeps an empty arrangement as well', () => {
    const view = createViewStore(createWorkbench())
    view.execute({ type: 'view.resetForProject', input: {} })
    expect(view.getState().tables).toEqual({})
  })

  test('applies, and a project reset restores what that project saved', () => {
    const view = createViewStore(createWorkbench())
    unregister = registerTable('test.buildings', REGISTERED)
    const result = view.execute({
      type: 'table.change',
      input: {
        tableId: 'test.buildings',
        change: { kind: 'setHidden', column: 'use', hidden: true },
      },
    })
    expect(result.outcome).toEqual({
      status: 'applied',
      summary: 'Hid Use in "Buildings".',
    })
    const saved = view.getState().tables
    expect(tablesDiffer(saved, {})).toBe(true)

    // Opening another project restores its own arrangements, none here.
    view.execute({ type: 'view.resetForProject', input: {} })
    expect(view.getState().tables).toEqual({})

    // Reopening the first restores what was saved with it; invalid entries
    // are dropped rather than failing the whole reset.
    view.execute({
      type: 'view.resetForProject',
      input: { tables: { ...saved, broken: { hidden: 'no' } } },
    })
    expect(view.getState().tables['test.buildings']?.hidden).toEqual(['use'])
    expect(view.getState().tables.broken).toBeUndefined()
    expect(tablesDiffer(view.getState().tables, saved)).toBe(false)
  })

  test('a table back at its defaults counts as unchanged', () => {
    const settings = defaultTableSettings()
    expect(tablesDiffer({ 'test.buildings': settings }, {})).toBe(false)
  })
})
