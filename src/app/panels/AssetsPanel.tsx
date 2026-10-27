import {
  ChartColumn,
  ChevronRight,
  CloudSun,
  FileText,
  Folder,
  LayoutDashboard,
  Layers,
  MapPin,
  Network,
  Boxes,
  Building2,
  Grid3x3,
  SquarePlus,
  Sun,
  Wrench,
  Zap,
  type LucideIcon,
} from 'lucide-react'
import { useMemo, useState, useId } from 'react'
import {
  Button,
  Collection,
  Tree,
  TreeItem,
  TreeItemContent,
  type Key,
} from 'react-aria-components'
import { capabilities } from '../../domain/capabilities.ts'
import type { AssetKind } from '../../domain/types.ts'
import { useServices, useWorkbenchSnapshot } from '../WorkbenchContext.tsx'
import { CapabilityBadge, StatusTag } from '../components/CapabilityBadge.tsx'
import { PanelHeader } from '../components/PanelHeader.tsx'
import { cx } from '../cx.ts'
import {
  buildAssetTree,
  relatedPages,
  type AssetTreeNode,
} from './assetTree.ts'
import styles from './panels.module.css'
import treeStyles from './tree.module.css'

const KIND_ICONS: Record<AssetKind, LucideIcon> = {
  group: Folder,
  location: MapPin,
  gisDataset: Layers,
  schemaRules: Wrench,
  buildings: Building2,
  zones: Grid3x3,
  shadingResult: Sun,
  pvYield: Zap,
  archetypes: Boxes,
  weather: CloudSun,
  energyModel: Building2,
  energyResult: ChartColumn,
  measure: SquarePlus,
  scenario: Layers,
  gridElements: Network,
  gridResult: ChartColumn,
  view: LayoutDashboard,
  report: FileText,
}

/**
 * The project's assets as a tree. Choosing one selects it, and the
 * Properties panel shows what it is and where it came from (decision 0028);
 * Enter opens its first page.
 */
export function AssetsPanel() {
  const headingId = useId()
  const { layout, workbench, showInspection } = useServices()
  const assets = useWorkbenchSnapshot((snapshot) => snapshot.state.assets)
  const rootIds = useWorkbenchSnapshot(
    (snapshot) => snapshot.state.rootAssetIds,
  )
  const selection = useWorkbenchSnapshot((snapshot) => snapshot.state.selection)
  const tree = useMemo(() => buildAssetTree(assets, rootIds), [assets, rootIds])
  // Groups start expanded so outputs appear where stages put them.
  const [expandedKeys, setExpandedKeys] = useState<Set<Key>>(
    () =>
      new Set(
        Object.values(assets)
          .filter((asset) => asset.kind === 'group')
          .map((asset) => asset.id),
      ),
  )
  const selectedId =
    selection.entityType === 'asset' ? (selection.ids[0] ?? null) : null

  const openFirstRelatedPage = (assetId: string) => {
    const asset = assets[assetId]
    const page = asset ? relatedPages(asset.kind)[0] : undefined
    if (page) layout.openPage(page)
  }

  return (
    <section className={styles.panel} aria-labelledby={headingId}>
      <PanelHeader
        title="Assets"
        headingId={headingId}
        meta={<CapabilityBadge id="assets.tree" />}
      />
      <Tree
        aria-label="Project assets"
        className={treeStyles.tree}
        items={tree}
        selectionMode="single"
        selectionBehavior="replace"
        selectedKeys={selectedId ? [selectedId] : []}
        onSelectionChange={(keys) => {
          if (keys === 'all') return
          const [first] = [...keys]
          if (first === undefined) {
            if (selectedId) {
              workbench.execute({ type: 'selection.clear', input: {} })
            }
            return
          }
          workbench.execute({
            type: 'selection.set',
            input: { entityType: 'asset', ids: [String(first)] },
          })
          showInspection()
        }}
        expandedKeys={expandedKeys}
        onExpandedChange={setExpandedKeys}
        onAction={(key) => openFirstRelatedPage(String(key))}
      >
        {function renderItem(node: AssetTreeNode) {
          const Icon = KIND_ICONS[node.asset.kind]
          const status = node.asset.capability
            ? capabilities[node.asset.capability].status
            : null
          return (
            <TreeItem
              id={node.id}
              textValue={node.asset.name}
              className={treeStyles.item}
            >
              <TreeItemContent>
                {({ hasChildItems, isExpanded, level }) => (
                  <div
                    className={treeStyles.row}
                    style={{ paddingInlineStart: `${(level - 1) * 0.875}rem` }}
                  >
                    {hasChildItems ? (
                      <Button
                        slot="chevron"
                        className={treeStyles.chevron}
                        aria-label={`${isExpanded ? 'Collapse' : 'Expand'} ${node.asset.name}`}
                      >
                        <ChevronRight
                          size={14}
                          aria-hidden="true"
                          className={cx(isExpanded && treeStyles.expanded)}
                        />
                      </Button>
                    ) : (
                      <span className={treeStyles.chevronSpacer} />
                    )}
                    <Icon size={14} aria-hidden="true" />
                    <span className={treeStyles.name}>{node.asset.name}</span>
                    {node.asset.kind === 'group' && node.children.length > 0 ? (
                      <span className={treeStyles.count}>
                        {node.children.length}
                      </span>
                    ) : null}
                    {status === 'planned' ? (
                      <StatusTag status="planned" />
                    ) : null}
                  </div>
                )}
              </TreeItemContent>
              <Collection items={node.children}>{renderItem}</Collection>
            </TreeItem>
          )
        }}
      </Tree>
      <p className={treeStyles.hint}>
        Choose an asset to see what it is and where it came from in Properties.
        Press Enter to open its page.
      </p>
    </section>
  )
}
