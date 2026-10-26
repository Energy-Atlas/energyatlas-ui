import { z } from 'zod'

// How a reader has arranged one table (decision 0027): hidden columns, sort,
// filters, per-column formats, and table style. Settings are keyed by a
// stable table id, kept per user in this browser, and changed only through
// the `table.change` view operation, so the agent can change them too.

export const DENSITIES = ['compact', 'comfortable'] as const
export const WIDTH_MODES = ['default', 'fit', 'even'] as const
export const ALIGNMENTS = ['start', 'end'] as const
export const SCALES = ['base', 'kilo'] as const

const filterSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('text'), contains: z.string().max(100) }),
  z.object({
    kind: z.literal('values'),
    values: z.array(z.string().max(200)).max(200),
  }),
  z.object({
    kind: z.literal('range'),
    min: z.number().finite().nullable(),
    max: z.number().finite().nullable(),
  }),
])

export type ColumnFilter = z.infer<typeof filterSchema>

// Every format entry is optional; null (or leaving it out) means the
// column's default, so a change can return any one entry to its default.
const formatSchema = z.object({
  /** Digits after the decimal point. */
  decimals: z.number().int().min(0).max(4).nullable().optional(),
  /** "kilo" shows kWh as MWh and kW as MW. */
  scale: z.enum(SCALES).nullable().optional(),
  /** Thousands separators. */
  grouping: z.boolean().nullable().optional(),
  align: z.enum(ALIGNMENTS).nullable().optional(),
})

export type ColumnFormat = z.infer<typeof formatSchema>

const styleSchema = z.object({
  density: z.enum(DENSITIES),
  /** Shaded alternate rows; off by default (decision 0027 amends 0021). */
  shaded: z.boolean(),
  wrap: z.boolean(),
  widths: z.enum(WIDTH_MODES),
  freezeFirst: z.boolean(),
})

export type TableStyle = z.infer<typeof styleSchema>

const sortSchema = z.object({
  column: z.string().min(1).max(100),
  direction: z.enum(['ascending', 'descending']),
})

export type TableSort = z.infer<typeof sortSchema>

export const tableSettingsSchema = z.object({
  hidden: z.array(z.string().max(100)).max(100),
  sort: sortSchema.nullable(),
  filters: z.record(z.string().max(100), filterSchema),
  formats: z.record(z.string().max(100), formatSchema),
  style: styleSchema,
})

export type TableSettings = z.infer<typeof tableSettingsSchema>

export const DEFAULT_STYLE: TableStyle = {
  density: 'compact',
  shaded: false,
  wrap: false,
  widths: 'default',
  freezeFirst: false,
}

export function defaultTableSettings(): TableSettings {
  return {
    hidden: [],
    sort: null,
    filters: {},
    formats: {},
    style: { ...DEFAULT_STYLE },
  }
}

const columnId = z.string().min(1).max(100)

/** One change to a table's settings; the input of `table.change`. */
export const tableChangeSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('setHidden'),
    column: columnId,
    hidden: z.boolean(),
  }),
  z.object({ kind: z.literal('showAllColumns') }),
  z.object({ kind: z.literal('sort'), sort: sortSchema.nullable() }),
  z.object({
    kind: z.literal('filter'),
    column: columnId,
    filter: filterSchema.nullable(),
  }),
  z.object({ kind: z.literal('clearFilters') }),
  z.object({
    kind: z.literal('format'),
    column: columnId,
    format: formatSchema,
  }),
  z.object({ kind: z.literal('style'), style: styleSchema.partial() }),
  z.object({ kind: z.literal('reset') }),
])

export type TableChange = z.infer<typeof tableChangeSchema>

/** Applies a change, returning new settings; the input is not modified. */
export function applyTableChange(
  settings: TableSettings,
  change: TableChange,
): TableSettings {
  switch (change.kind) {
    case 'setHidden': {
      const hidden = settings.hidden.filter((id) => id !== change.column)
      return {
        ...settings,
        hidden: change.hidden ? [...hidden, change.column] : hidden,
      }
    }
    case 'showAllColumns':
      return { ...settings, hidden: [] }
    case 'sort':
      return { ...settings, sort: change.sort }
    case 'filter': {
      const filters = { ...settings.filters }
      if (change.filter && !isEmptyFilter(change.filter)) {
        filters[change.column] = change.filter
      } else {
        delete filters[change.column]
      }
      return { ...settings, filters }
    }
    case 'clearFilters':
      return { ...settings, filters: {} }
    case 'format': {
      // Null or undefined entries return a setting to the column's default.
      const merged: ColumnFormat = {
        ...settings.formats[change.column],
        ...change.format,
      }
      for (const key of Object.keys(merged) as (keyof ColumnFormat)[]) {
        if (merged[key] === undefined || merged[key] === null) {
          delete merged[key]
        }
      }
      const formats = { ...settings.formats }
      if (Object.keys(merged).length > 0) formats[change.column] = merged
      else delete formats[change.column]
      return { ...settings, formats }
    }
    case 'style':
      return { ...settings, style: { ...settings.style, ...change.style } }
    case 'reset':
      return defaultTableSettings()
  }
}

export function isEmptyFilter(filter: ColumnFilter): boolean {
  switch (filter.kind) {
    case 'text':
      return filter.contains.trim() === ''
    case 'values':
      return false
    case 'range':
      return filter.min === null && filter.max === null
  }
}

/** Whether the reader has changed anything, so the toolbar stays visible. */
export function isCustomised(settings: TableSettings): boolean {
  return (
    settings.hidden.length > 0 ||
    settings.sort !== null ||
    Object.keys(settings.filters).length > 0 ||
    Object.keys(settings.formats).length > 0 ||
    JSON.stringify(settings.style) !== JSON.stringify(DEFAULT_STYLE)
  )
}

/** Reads stored settings, dropping any table whose entry no longer parses. */
export function parseStoredTables(
  value: unknown,
): Record<string, TableSettings> {
  if (typeof value !== 'object' || value === null) return {}
  const tables: Record<string, TableSettings> = {}
  for (const [id, entry] of Object.entries(value)) {
    const parsed = tableSettingsSchema.safeParse(entry)
    if (parsed.success) tables[id] = parsed.data
  }
  return tables
}
