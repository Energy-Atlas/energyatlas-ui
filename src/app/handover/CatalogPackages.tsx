import { useEffect, useId, useRef, useState } from 'react'
import { Button } from 'react-aria-components'
import { useClientSnapshot, useServices } from '../WorkbenchContext.tsx'
import { ActionButton } from '../components/ActionButton.tsx'
import { InlineAlert } from '../components/InlineAlert.tsx'
import { SelectableList } from '../components/SelectableList.tsx'
import componentStyles from '../components/components.module.css'
import { cx } from '../cx.ts'
import { formatDateTime } from '../format.ts'
import shellStyles from '../shell/shell.module.css'
import styles from './handover.module.css'

/** Kilobytes a package takes in browser storage, for the list. */
export function packageSize(bytes: number): string {
  return `${Math.ceil(bytes / 1024).toLocaleString('en-US')} KB`
}

/**
 * The handover packages in this browser, in the Hand over dialog (decision
 * 0032, stage 5): packages share storage with saved projects, so the modeller
 * can remove older ones here as well as on the viewer page.
 */
export function CatalogPackages() {
  const { client } = useServices()
  const meta = useClientSnapshot((snapshot) => snapshot.meta)
  const pending = useClientSnapshot((snapshot) => snapshot.pending)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [confirming, setConfirming] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const headingId = useId()
  const listed = useRef(false)
  useEffect(() => {
    if (listed.current) return
    listed.current = true
    void client.listPackages()
  }, [client])

  const loading =
    !meta.packagesReady ||
    pending.some((request) => request.type === 'handover.list')
  const removing = pending.some((request) => request.type === 'handover.remove')
  const selected =
    meta.packages.find((pkg) => pkg.id === selectedId) ??
    meta.packages[0] ??
    null
  const total = meta.packages.reduce((sum, pkg) => sum + pkg.bytes, 0)

  return (
    <section className={styles.catalog} aria-labelledby={headingId}>
      <h3 id={headingId} className={shellStyles.dialogSection}>
        Packages in this browser
      </h3>
      {loading ? (
        <p role="status">Loading handover packages…</p>
      ) : meta.packagesError ? (
        <InlineAlert tone="danger">{meta.packagesError}</InlineAlert>
      ) : meta.packages.length === 0 ? (
        <p className={componentStyles.muted}>No packages kept here yet.</p>
      ) : (
        <>
          <p className={componentStyles.muted}>
            {`They take about ${packageSize(total)} of the storage saved projects use too.`}
          </p>
          <SelectableList
            aria-label="Handover packages in this browser"
            className={styles.catalogList}
            items={meta.packages.map((pkg) => {
              const description = `Handed over ${formatDateTime(pkg.createdAt)} · ${packageSize(pkg.bytes)}`
              return {
                id: pkg.id,
                title: pkg.name,
                meta: description,
                description,
              }
            })}
            selectedId={selected?.id ?? null}
            onSelect={(id) => {
              setSelectedId(id)
              setConfirming(false)
              setError(null)
            }}
          />
          {error ? <InlineAlert tone="danger">{error}</InlineAlert> : null}
          {confirming && selected ? (
            <InlineAlert
              tone="warning"
              title={`Remove "${selected.name}" from this browser?`}
              actions={
                <>
                  <Button
                    className={componentStyles.button}
                    autoFocus
                    onPress={() => setConfirming(false)}
                  >
                    Keep it
                  </Button>
                  <Button
                    className={cx(
                      componentStyles.button,
                      componentStyles.primary,
                    )}
                    isDisabled={removing}
                    onPress={() => {
                      void client.removePackage(selected.id).then((result) => {
                        setConfirming(false)
                        setSelectedId(null)
                        setError(
                          result.outcome.status === 'rejected'
                            ? result.outcome.issues
                                .map((issue) => issue.message)
                                .join(' ')
                            : null,
                        )
                      })
                    }}
                  >
                    Remove package
                  </Button>
                </>
              }
            >
              The layouts handed over in it go with it. Downloaded copies are
              not affected.
            </InlineAlert>
          ) : selected ? (
            <div className={shellStyles.dialogActions}>
              <ActionButton
                label={`Remove the handover package ${selected.name} from this browser`}
                disabledReason={removing ? 'A package is being removed.' : null}
                onPress={() => setConfirming(true)}
              >
                Remove from this browser…
              </ActionButton>
            </div>
          ) : null}
        </>
      )}
    </section>
  )
}
