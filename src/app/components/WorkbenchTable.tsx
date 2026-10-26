import { useEffect } from 'react'
import { useServices, useViewState } from '../WorkbenchContext.tsx'
import { downloadText, fileSlug } from '../csv.ts'
import { canScale, columnType } from '../tables/tableModel.ts'
import { registerTable } from '../tables/tableRegistry.ts'
import {
  defaultTableSettings,
  type TableSettings,
} from '../tables/tableSettings.ts'
import { DataTable, type DataTableProps } from './DataTable.tsx'

const DEFAULT_SETTINGS: TableSettings = defaultTableSettings()

type WorkbenchTableProps<Row> = Omit<
  DataTableProps<Row>,
  'settings' | 'onChange' | 'onExport' | 'exportOptions'
> & {
  /** Lines that identify the export, such as the run or the project. */
  exportContext?: string[]
  /** False leaves Download out, for tables whose rows are not data. */
  exportable?: boolean
}

/**
 * A DataTable inside the workbench: its arrangement lives in view state under
 * the table id and changes through the `table.change` view operation, it is
 * registered so the agent can name its columns, and its CSV export is
 * recorded in the operation log.
 */
export function WorkbenchTable<Row>({
  exportContext,
  exportable = true,
  ...props
}: WorkbenchTableProps<Row>) {
  const { view, workbench } = useServices()
  const settings =
    useViewState((current) => current.tables[props.id]) ?? DEFAULT_SETTINGS
  const label = props['aria-label']
  const columnKey = props.columns
    .map((column) => `${column.id}:${column.header}:${column.type ?? ''}`)
    .join('|')

  useEffect(
    () =>
      registerTable(props.id, {
        label,
        columns: props.columns.map((column) => ({
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
    [props.id, label, columnKey],
  )

  return (
    <DataTable
      {...props}
      settings={settings}
      onChange={(change) =>
        view.execute({
          type: 'table.change',
          input: { tableId: props.id, change },
        })
      }
      exportOptions={
        exportable
          ? {
              fileName: `energyatlas-${fileSlug(label, 'table')}.csv`,
              context: [
                `project: ${workbench.getState().project.name}`,
                ...(exportContext ?? []),
              ],
            }
          : null
      }
      onExport={(csv, fileName, rowCount) => {
        downloadText(fileName, csv)
        workbench.record({
          type: 'table.export',
          title: 'Download table as CSV',
          input: { tableId: props.id },
          summary: `Downloaded "${label}" as CSV with ${rowCount} row${rowCount === 1 ? '' : 's'}.`,
        })
      }}
    />
  )
}
