import { useEffect } from 'react'
import { useServices, useViewState } from '../WorkbenchContext.tsx'
import { downloadText, fileSlug } from '../csv.ts'
import { canScale, columnType, type DataColumn } from '../tables/tableModel.ts'
import { registerTable } from '../tables/tableRegistry.ts'
import {
  defaultTableSettings,
  type TableChange,
  type TableSettings,
} from '../tables/tableSettings.ts'

const DEFAULT_SETTINGS: TableSettings = defaultTableSettings()

export type WorkbenchTableBinding = {
  settings: TableSettings
  onChange: (change: TableChange) => void
  /** Null when the table has no Download tool. */
  exportOptions: { fileName: string; context: string[] } | null
  onExport: (csv: string, fileName: string, rowCount: number) => void
}

/**
 * Binds a table, whichever renderer draws it, to the workbench: its
 * arrangement lives in view state under the table id and changes through the
 * `table.change` view operation, it is registered so the agent can name its
 * columns, and its CSV export is recorded in the operation log.
 */
export function useWorkbenchTable<Row>({
  id,
  label,
  columns,
  exportContext,
  exportable = true,
}: {
  id: string
  label: string
  columns: DataColumn<Row>[]
  /** Lines that identify the export, such as the run or the project. */
  exportContext?: string[]
  /** False leaves Download out, for tables whose rows are not data. */
  exportable?: boolean
}): WorkbenchTableBinding {
  const { view, workbench } = useServices()
  const settings =
    useViewState((current) => current.tables[id]) ?? DEFAULT_SETTINGS
  const columnKey = columns
    .map((column) => `${column.id}:${column.header}:${column.type ?? ''}`)
    .join('|')

  useEffect(
    () =>
      registerTable(id, {
        label,
        columns: columns.map((column) => ({
          id: column.id,
          header: column.header,
          type: columnType(column),
          hideable: !column.rowHeader && column.hideable !== false,
          scalable: canScale(column),
          sortable: !column.action && column.sortable !== false,
          filterable: !column.action && column.filterable !== false,
          unit: column.unit,
        })),
      }),
    // The registration follows the columns' identity, not each render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [id, label, columnKey],
  )

  return {
    settings,
    onChange: (change) =>
      view.execute({
        type: 'table.change',
        input: { tableId: id, change },
      }),
    exportOptions: exportable
      ? {
          fileName: `energyatlas-${fileSlug(label, 'table')}.csv`,
          context: [
            `project: ${workbench.getState().project.name}`,
            ...(exportContext ?? []),
          ],
        }
      : null,
    onExport: (csv, fileName, rowCount) => {
      downloadText(fileName, csv)
      workbench.record({
        type: 'table.export',
        title: 'Download table as CSV',
        input: { tableId: id },
        summary: `Downloaded "${label}" as CSV with ${rowCount} row${rowCount === 1 ? '' : 's'}.`,
      })
    },
  }
}
