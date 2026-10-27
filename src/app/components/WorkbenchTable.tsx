import { DataTable, type DataTableProps } from './DataTable.tsx'
import { useWorkbenchTable } from './useWorkbenchTable.ts'

type WorkbenchTableProps<Row> = Omit<
  DataTableProps<Row>,
  'settings' | 'onChange' | 'onExport' | 'exportOptions'
> & {
  /** Lines that identify the export, such as the run or the project. */
  exportContext?: string[]
  /** False leaves Download out, for tables whose rows are not data. */
  exportable?: boolean
}

/** A DataTable inside the workbench, bound by `useWorkbenchTable`. */
export function WorkbenchTable<Row>({
  exportContext,
  exportable = true,
  ...props
}: WorkbenchTableProps<Row>) {
  const binding = useWorkbenchTable({
    id: props.id,
    label: props['aria-label'],
    columns: props.columns,
    exportContext,
    exportable,
  })
  return <DataTable {...props} {...binding} />
}
