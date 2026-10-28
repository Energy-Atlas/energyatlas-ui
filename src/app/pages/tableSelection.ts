import type { GridApi, SelectionChangedEvent } from 'ag-grid-community'
import { useEffect } from 'react'
import type { SelectableEntity, Selection } from '../../domain/types.ts'
import { useServices } from '../WorkbenchContext.tsx'

// The Table page's grids share the workbench selection: rows are selected by
// clicking them, and the grid mirrors selections made elsewhere.

// Rows are selected by clicking them; the selection is the workbench's.
export const ROW_SELECTION = {
  mode: 'multiRow',
  checkboxes: false,
  headerCheckbox: false,
  enableClickSelection: true,
} as const

// Grid selection events caused by our own syncing must not echo back as commands.
const PROGRAMMATIC_SOURCES = new Set([
  'api',
  'apiSelectAll',
  'rowDataChanged',
  'gridInitializing',
])

export function useSelectionSync<Row extends { id: string }>(
  apiRef: React.RefObject<GridApi<Row> | null>,
  selection: Selection,
  entityType: SelectableEntity,
  rows: Row[],
  /** Changes once the grid is ready, for a grid mounted after the selection. */
  ready = true,
) {
  useEffect(() => {
    const api = apiRef.current
    if (!api) return
    const wanted = new Set(
      selection.entityType === entityType ? selection.ids : [],
    )
    api.forEachNode((node) => {
      const shouldSelect = Boolean(node.data && wanted.has(node.data.id))
      if (node.isSelected() !== shouldSelect) {
        node.setSelected(shouldSelect, false, 'api')
      }
    })
    const first =
      selection.entityType === entityType ? selection.ids[0] : undefined
    const node = first ? api.getRowNode(first) : undefined
    if (node) api.ensureNodeVisible(node)
  }, [apiRef, selection, entityType, rows, ready])
}

export function useSelectionHandler<Row extends { id: string }>(
  entityType: SelectableEntity,
) {
  const { workbench } = useServices()
  return (event: SelectionChangedEvent<Row>) => {
    if (PROGRAMMATIC_SOURCES.has(event.source)) return
    const ids = event.api.getSelectedRows().map((row) => row.id)
    workbench.execute(
      ids.length > 0
        ? { type: 'selection.set', input: { entityType, ids } }
        : { type: 'selection.clear', input: {} },
    )
  }
}
