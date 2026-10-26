import { describeFilter } from './tableModel.ts'
import type { RegisteredTable } from './tableRegistry.ts'
import type { TableChange } from './tableSettings.ts'

// Checks and words for the `table.change` view operation, kept apart from the
// operation registry so they are unit-tested on their own.

function columnOf(table: RegisteredTable, id: string) {
  return table.columns.find((column) => column.id === id)
}

function columnList(table: RegisteredTable): string {
  return table.columns
    .map((column) => `${column.id} (${column.header})`)
    .join(', ')
}

/** Why a change cannot apply to the table, or null when it can. */
export function tableChangeIssue(
  table: RegisteredTable,
  change: TableChange,
): { path: string; message: string } | null {
  const column =
    'column' in change
      ? change.column
      : change.kind === 'sort' && change.sort
        ? change.sort.column
        : null
  if (column === null) return null
  const found = columnOf(table, column)
  if (!found) {
    return {
      path: change.kind === 'sort' ? 'change.sort.column' : 'change.column',
      message: `"${table.label}" has no column "${column}". Its columns: ${columnList(table)}.`,
    }
  }
  if (change.kind === 'setHidden' && change.hidden && !found.hideable) {
    return {
      path: 'change.hidden',
      message: `${found.header} names each row in "${table.label}", so it stays shown.`,
    }
  }
  if (change.kind === 'sort' && !found.sortable) {
    return {
      path: 'change.sort.column',
      message: `${found.header} keeps its own order in "${table.label}" and cannot be sorted.`,
    }
  }
  if (change.kind === 'filter' && change.filter && !found.filterable) {
    return {
      path: 'change.column',
      message: `${found.header} in "${table.label}" cannot be filtered.`,
    }
  }
  if (change.kind === 'filter' && change.filter) {
    const numeric = found.type === 'number'
    if (change.filter.kind === 'text' && numeric) {
      return {
        path: 'change.filter',
        message: `${found.header} is a number column; filter it by range.`,
      }
    }
    if (change.filter.kind === 'range' && !numeric) {
      return {
        path: 'change.filter',
        message: `${found.header} is not a number column; filter it by text or values.`,
      }
    }
    if (change.filter.kind === 'values' && found.type !== 'enum') {
      return {
        path: 'change.filter',
        message: `${found.header} has no value list; filter it by ${numeric ? 'range' : 'text'}.`,
      }
    }
    if (
      change.filter.kind === 'range' &&
      change.filter.min !== null &&
      change.filter.max !== null &&
      change.filter.min > change.filter.max
    ) {
      return {
        path: 'change.filter',
        message: 'The lower bound is above the upper bound.',
      }
    }
  }
  if (
    change.kind === 'format' &&
    change.format.scale === 'kilo' &&
    !found.scalable
  ) {
    return {
      path: 'change.format.scale',
      message: `${found.header} has no unit that scales to thousands.`,
    }
  }
  return null
}

/** What a change did, for the operation log and the status bar. */
export function describeTableChange(
  table: RegisteredTable,
  change: TableChange,
): string {
  const header = (id: string) => columnOf(table, id)?.header ?? id
  const name = `"${table.label}"`
  switch (change.kind) {
    case 'setHidden':
      return `${change.hidden ? 'Hid' : 'Showed'} ${header(change.column)} in ${name}.`
    case 'showAllColumns':
      return `Showed every column in ${name}.`
    case 'sort':
      return change.sort
        ? `Sorted ${name} by ${header(change.sort.column)}, ${change.sort.direction}.`
        : `Cleared the sort of ${name}.`
    case 'filter':
      return change.filter
        ? `Filtered ${name}: ${header(change.column)} ${describeFilter(change.filter, columnOf(table, change.column)?.unit)}.`
        : `Cleared the ${header(change.column)} filter of ${name}.`
    case 'clearFilters':
      return `Cleared every filter of ${name}.`
    case 'format':
      return `Changed how ${header(change.column)} reads in ${name}.`
    case 'style': {
      const parts = Object.entries(change.style).map(([key, value]) => {
        switch (key) {
          case 'density':
            return `${String(value)} rows`
          case 'shaded':
            return value ? 'shaded alternate rows' : 'no shading'
          case 'wrap':
            return value ? 'wrapped text' : 'single-line text'
          case 'widths':
            return value === 'fit'
              ? 'columns fitted to content'
              : value === 'even'
                ? 'evenly distributed columns'
                : 'default column widths'
          case 'freezeFirst':
            return value ? 'first column frozen' : 'first column scrolls'
          default:
            return key
        }
      })
      return `Styled ${name}: ${parts.join(', ')}.`
    }
    case 'reset':
      return `Reset ${name} to its default columns, order, filters, and style.`
  }
}
