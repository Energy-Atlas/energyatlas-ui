import { GROUP } from '../../domain/assets.ts'
import type { Asset, AssetKind, WorkflowState } from '../../domain/types.ts'
import type { PageId } from '../layout/layoutController.ts'
import type { SavedLayout } from '../layouts/savedLayout.ts'

export type AssetTreeNode = {
  id: string
  asset: Asset
  children: AssetTreeNode[]
}

/** Builds the displayed tree; ignores missing children and guards against cycles. */
export function buildAssetTree(
  assets: Record<string, Asset>,
  rootIds: string[],
): AssetTreeNode[] {
  const visit = (id: string, ancestors: Set<string>): AssetTreeNode[] => {
    const asset = assets[id]
    if (!asset || ancestors.has(id)) return []
    const path = new Set(ancestors).add(id)
    return [
      {
        id,
        asset,
        children: asset.childIds.flatMap((childId) => visit(childId, path)),
      },
    ]
  }
  return rootIds.flatMap((id) => visit(id, new Set()))
}

export const ASSET_KIND_LABELS: Record<AssetKind, string> = {
  group: 'Group',
  location: 'Project location',
  gisDataset: 'GIS dataset',
  schemaRules: 'Schema rules',
  buildings: 'Buildings',
  zones: 'Thermal zones',
  shadingResult: 'Shading result',
  pvYield: 'PV yield',
  archetypes: 'Archetypes',
  weather: 'Weather',
  energyModel: 'Energy model',
  energyResult: 'Energy result',
  measure: 'Measure',
  scenario: 'Scenario',
  gridElements: 'Grid elements',
  gridResult: 'Grid result',
  view: 'View',
  report: 'Report',
}

const RELATED_PAGES: Partial<Record<AssetKind, PageId[]>> = {
  location: ['map'],
  gisDataset: ['map', 'table'],
  buildings: ['map', 'table'],
  zones: ['table'],
  shadingResult: ['map'],
  pvYield: ['map', 'table'],
  archetypes: ['table'],
  energyModel: ['dashboard'],
  energyResult: ['dashboard'],
  measure: ['creator'],
  scenario: ['creator', 'dashboard'],
  gridElements: ['map', 'table'],
  gridResult: ['dashboard', 'map'],
  view: ['dashboard'],
}

export function relatedPages(kind: AssetKind): PageId[] {
  return RELATED_PAGES[kind] ?? []
}

export function describeProvenance(
  asset: Asset,
  stages: WorkflowState['stages'],
): string {
  const provenance = asset.provenance
  switch (provenance.kind) {
    case 'skeleton':
      return 'Part of the project structure.'
    case 'stage':
      return `Produced by "${stages[provenance.stageId]?.name ?? provenance.stageId}" (run ${provenance.runId}, operation ${provenance.operationId}).`
    case 'operation':
      return `Created by a ${provenance.source} action (operation ${provenance.operationId}).`
  }
}

/** Asset ids of project layouts shown in the tree, which are view state. */
export const LAYOUT_ASSET_PREFIX = 'layout-asset:'

/**
 * The project's saved layouts as View assets under View > Layouts (decision
 * 0032). They are view state saved beside the model, not model assets, so
 * the tree adds them for display; choosing one opens the Layouts dialog.
 */
export function withLayoutAssets(
  assets: Record<string, Asset>,
  layouts: SavedLayout[],
  defaultId: string | null,
): Record<string, Asset> {
  const group = assets[GROUP.layouts]
  if (!group || layouts.length === 0) return assets
  const merged = { ...assets }
  const ids = layouts.map((layout) => `${LAYOUT_ASSET_PREFIX}${layout.id}`)
  merged[GROUP.layouts] = { ...group, childIds: [...group.childIds, ...ids] }
  layouts.forEach((layout, index) => {
    const id = ids[index] ?? ''
    merged[id] = {
      id,
      kind: 'view',
      name: layout.id === defaultId ? `${layout.name} (default)` : layout.name,
      parentId: GROUP.layouts,
      childIds: [],
      provenance: {
        kind: 'operation',
        source: layout.createdBy,
        operationId: '',
      },
      capability: null,
      summary: `Saved layout, updated ${layout.updatedAt}.`,
      entityIds: [],
    }
  })
  return merged
}
