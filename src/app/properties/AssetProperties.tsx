import { capabilities } from '../../domain/capabilities.ts'
import type { Asset } from '../../domain/types.ts'
import { useServices, useWorkbenchSnapshot } from '../WorkbenchContext.tsx'
import { ActionButton } from '../components/ActionButton.tsx'
import { StatusTag } from '../components/CapabilityBadge.tsx'
import { PropertyList } from '../components/PropertyList.tsx'
import { PAGES } from '../layout/layoutController.ts'
import {
  ASSET_KIND_LABELS,
  describeProvenance,
  relatedPages,
} from '../panels/assetTree.ts'
import styles from './properties.module.css'

/**
 * An asset from the Assets tree in Properties: what it is, where it came
 * from, and the pages that show it. Assets are outputs and groups, so they
 * are read here, not edited.
 */
export function AssetProperties({ asset }: { asset: Asset }) {
  const { layout } = useServices()
  const stages = useWorkbenchSnapshot(
    (snapshot) => snapshot.state.workflow.stages,
  )
  const capability = asset.capability ? capabilities[asset.capability] : null
  const pages = relatedPages(asset.kind)
  return (
    <section className={styles.definition} aria-label={`Asset ${asset.name}`}>
      <header className={styles.header}>
        <p className={styles.eyebrow}>{ASSET_KIND_LABELS[asset.kind]}</p>
        <h3 className={styles.title}>{asset.name}</h3>
      </header>
      <PropertyList
        items={[
          { label: 'Kind', value: ASSET_KIND_LABELS[asset.kind] },
          asset.summary ? { label: 'Summary', value: asset.summary } : null,
          {
            label: 'Provenance',
            value: describeProvenance(asset, stages),
          },
          capability
            ? {
                label: 'Status',
                value: (
                  <>
                    {capability.status === 'working' ? null : (
                      <StatusTag status={capability.status} />
                    )}{' '}
                    {capability.explanation}
                  </>
                ),
              }
            : null,
        ]}
      />
      {pages.length > 0 ? (
        <div className={styles.actions}>
          {pages.map((page) => (
            <ActionButton
              key={page}
              label={`Open ${PAGES[page].name} for ${asset.name}`}
              disabledReason={null}
              onPress={() => layout.openPage(page)}
            >
              Open {PAGES[page].name}
            </ActionButton>
          ))}
        </div>
      ) : null}
    </section>
  )
}
