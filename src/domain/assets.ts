import type { CapabilityId } from './capabilities.ts'
import type { Asset, AssetKind, Provenance, WorkbenchState } from './types.ts'

// Asset tree skeleton from decision 0003. Groups always exist so the tree
// shows the whole project structure; stage runs and creators fill them.

export const GROUP = {
  energyModel: 'group:energy-model',
  buildings: 'group:buildings',
  archetypes: 'group:archetypes',
  schemaRules: 'group:schema-rules',
  shadingResults: 'group:shading-results',
  energyResults: 'group:energy-results',
  weather: 'group:weather',
  scenarios: 'group:scenarios',
  measures: 'group:measures',
  gridModel: 'group:grid-model',
  gridLines: 'group:grid-lines',
  gridBuses: 'group:grid-buses',
  gridTransformers: 'group:grid-transformers',
  gridUtilityPv: 'group:grid-utility-pv',
  gridLoads: 'group:grid-loads',
  gridResults: 'group:grid-results',
  gasNetwork: 'group:gas-network',
  data: 'group:data',
  tables: 'group:tables',
  userTables: 'group:user-tables',
  gisDatasets: 'group:gis-datasets',
  documents: 'group:documents',
  view: 'group:view',
  views: 'group:views',
  customWidgets: 'group:custom-widgets',
  reports: 'group:reports',
  layouts: 'group:layouts',
} as const

type SkeletonNode = {
  id: string
  name: string
  capability?: CapabilityId
  children?: SkeletonNode[]
}

const SKELETON: SkeletonNode[] = [
  {
    id: GROUP.energyModel,
    name: 'Energy model',
    children: [
      { id: GROUP.buildings, name: 'Buildings' },
      { id: GROUP.archetypes, name: 'Archetypes' },
      { id: GROUP.schemaRules, name: 'Schema rules' },
      { id: GROUP.shadingResults, name: 'Shading results' },
      { id: GROUP.energyResults, name: 'Energy results' },
      { id: GROUP.weather, name: 'Weather' },
      { id: GROUP.scenarios, name: 'Scenarios' },
      { id: GROUP.measures, name: 'Measures' },
    ],
  },
  {
    id: GROUP.gridModel,
    name: 'Grid model',
    children: [
      { id: GROUP.gridLines, name: 'Lines' },
      { id: GROUP.gridBuses, name: 'Buses' },
      { id: GROUP.gridTransformers, name: 'Transformers' },
      { id: GROUP.gridUtilityPv, name: 'Utility PV' },
      { id: GROUP.gridLoads, name: 'Loads and load centers' },
      { id: GROUP.gridResults, name: 'Grid results' },
      {
        id: GROUP.gasNetwork,
        name: 'Gas network',
        capability: 'grid.gasNetwork',
      },
    ],
  },
  {
    id: GROUP.data,
    name: 'Data',
    children: [
      {
        id: GROUP.tables,
        name: 'Tables',
        children: [
          {
            id: GROUP.userTables,
            name: 'User tables',
            capability: 'data.userTableImport',
          },
          { id: GROUP.gisDatasets, name: 'GIS datasets' },
        ],
      },
      {
        id: GROUP.documents,
        name: 'Documents',
        capability: 'data.documentViewer',
      },
    ],
  },
  {
    id: GROUP.view,
    name: 'View',
    children: [
      { id: GROUP.views, name: 'Views' },
      {
        id: GROUP.customWidgets,
        name: 'Custom widgets',
        capability: 'dashboard.customWidgets',
      },
      { id: GROUP.reports, name: 'Reports' },
      {
        id: GROUP.layouts,
        name: 'Layouts',
        capability: 'layout.saveAsView',
      },
    ],
  },
]

export function createAssetSkeleton(): {
  assets: Record<string, Asset>
  rootAssetIds: string[]
} {
  const assets: Record<string, Asset> = {}
  const visit = (node: SkeletonNode, parentId: string | null) => {
    assets[node.id] = {
      id: node.id,
      kind: 'group',
      name: node.name,
      parentId,
      childIds: (node.children ?? []).map((child) => child.id),
      provenance: { kind: 'skeleton' },
      capability: node.capability ?? null,
      summary: null,
      entityIds: [],
    }
    for (const child of node.children ?? []) visit(child, node.id)
  }
  for (const node of SKELETON) visit(node, null)
  return { assets, rootAssetIds: SKELETON.map((node) => node.id) }
}

export type AssetInput = {
  id: string
  kind: AssetKind
  name: string
  parentId: string
  provenance: Provenance
  capability?: CapabilityId | null
  summary?: string | null
  entityIds?: string[]
}

/** Creates or replaces an asset under its parent, keeping existing children. */
export function upsertAsset(state: WorkbenchState, input: AssetInput): void {
  const parent = state.assets[input.parentId]
  if (!parent) {
    throw new Error(`Unknown parent asset "${input.parentId}"`)
  }
  const existing = state.assets[input.id]
  if (existing?.parentId && existing.parentId !== input.parentId) {
    const previousParent = state.assets[existing.parentId]
    if (previousParent) {
      previousParent.childIds = previousParent.childIds.filter(
        (id) => id !== input.id,
      )
    }
  }
  state.assets[input.id] = {
    id: input.id,
    kind: input.kind,
    name: input.name,
    parentId: input.parentId,
    childIds: existing?.childIds ?? [],
    provenance: input.provenance,
    capability: input.capability ?? null,
    summary: input.summary ?? null,
    entityIds: input.entityIds ?? [],
  }
  if (!parent.childIds.includes(input.id)) {
    parent.childIds.push(input.id)
  }
}

/** Removes a derived asset and its link from its parent; children are not expected. */
export function removeAsset(state: WorkbenchState, assetId: string): void {
  const asset = state.assets[assetId]
  if (!asset) return
  const parent = asset.parentId ? state.assets[asset.parentId] : undefined
  if (parent) parent.childIds = parent.childIds.filter((id) => id !== assetId)
  delete state.assets[assetId]
}

/** Ancestors from the root down to the asset itself, for breadcrumbs. */
export function assetPath(state: WorkbenchState, assetId: string): Asset[] {
  const path: Asset[] = []
  let current = state.assets[assetId]
  while (current) {
    path.unshift(current)
    current = current.parentId ? state.assets[current.parentId] : undefined
  }
  return path
}
