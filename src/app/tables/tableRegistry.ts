import type { ColumnType } from './tableModel.ts'

// Tables on screen register their columns here, so the `table.change` view
// operation can check a table id and column ids and name the alternatives
// (for the agent as much as for controls). Registration is counted, because
// one table id can be shown more than once (for example two residual tables).

export type RegisteredColumn = {
  id: string
  header: string
  type: ColumnType
  /** False for the row-naming column and columns that must stay. */
  hideable: boolean
  /** Whether a kilo scale applies (kWh to MWh). */
  scalable: boolean
  sortable: boolean
  filterable: boolean
  /** The column's own unit, in which range filters are stored. */
  unit?: string
}

export type RegisteredTable = { label: string; columns: RegisteredColumn[] }

const tables = new Map<string, { table: RegisteredTable; count: number }>()

/** Registers a shown table; the returned function unregisters it. */
export function registerTable(id: string, table: RegisteredTable): () => void {
  const current = tables.get(id)
  tables.set(id, { table, count: (current?.count ?? 0) + 1 })
  return () => {
    const entry = tables.get(id)
    if (!entry) return
    if (entry.count <= 1) tables.delete(id)
    else tables.set(id, { ...entry, count: entry.count - 1 })
  }
}

export function registeredTable(id: string): RegisteredTable | undefined {
  return tables.get(id)?.table
}

export function registeredTableIds(): string[] {
  return [...tables.keys()].sort()
}
