import { useEffect, useId, useRef, useState } from 'react'
import type { PackageSummary } from '../../server/handover.ts'
import { useClientSnapshot, useServices } from '../WorkbenchContext.tsx'
import { ActionButton } from '../components/ActionButton.tsx'
import { ConfirmDialog } from '../components/ConfirmDialog.tsx'
import { InlineAlert } from '../components/InlineAlert.tsx'
import { SelectableList } from '../components/SelectableList.tsx'
import componentStyles from '../components/components.module.css'
import { formatDateTime } from '../format.ts'
import shellStyles from '../shell/shell.module.css'
import styles from './handover.module.css'

/** Kilobytes a view takes in browser storage, for the list. */
export function packageSize(bytes: number): string {
  return `${Math.ceil(bytes / 1024).toLocaleString('en-US')} KB`
}

/**
 * Asks before a view leaves this browser's list of views (decision 0036),
 * from the modeller's Save as dialog and the viewer's start page alike.
 */
export function RemoveViewDialog({
  view,
  onOpenChange,
  onRemoved,
  returnFocus,
}: {
  /** The view to remove; the dialog is open while it is set. */
  view: PackageSummary | null
  onOpenChange: (isOpen: boolean) => void
  onRemoved?: () => void
  returnFocus?: () => HTMLElement | null
}) {
  const { client } = useServices()
  const pending = useClientSnapshot((snapshot) => snapshot.pending.length > 0)
  // The name stays while the dialog closes after the view is gone.
  const [shown, setShown] = useState(view)
  if (view && view !== shown) setShown(view)
  return (
    <ConfirmDialog
      isOpen={view !== null}
      onOpenChange={onOpenChange}
      title={`Remove the view "${shown?.name ?? ''}" from this browser?`}
      confirm={{
        label: 'Remove view',
        disabledReason: pending
          ? 'Waiting for the server to answer an earlier request.'
          : null,
        onPress: async () => {
          if (!view) return
          const result = await client.removePackage(view.id)
          if (result.outcome.status === 'rejected') {
            return result.outcome.issues.map((issue) => issue.message).join(' ')
          }
          onRemoved?.()
        },
      }}
      returnFocus={returnFocus}
    >
      <p>
        The layouts kept in it go with it. Downloaded view files are not
        affected. This cannot be undone.
      </p>
    </ConfirmDialog>
  )
}

/**
 * The views kept in this browser, in the Save as dialog (decision 0036):
 * views share storage with saved projects, so the modeller can remove older
 * ones here as well as on the viewer's start page.
 */
export function ViewsInBrowser() {
  const { client } = useServices()
  const meta = useClientSnapshot((snapshot) => snapshot.meta)
  const pending = useClientSnapshot((snapshot) => snapshot.pending)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [removing, setRemoving] = useState<PackageSummary | null>(null)
  const headingId = useId()
  const sectionRef = useRef<HTMLElement>(null)
  const listed = useRef(false)
  useEffect(() => {
    if (listed.current) return
    listed.current = true
    void client.listPackages()
  }, [client])

  const loading =
    !meta.packagesReady ||
    pending.some((request) => request.type === 'handover.list')
  const busy = pending.some((request) => request.type === 'handover.remove')
  const selected =
    meta.packages.find((pkg) => pkg.id === selectedId) ??
    meta.packages[0] ??
    null
  const total = meta.packages.reduce((sum, pkg) => sum + pkg.bytes, 0)

  return (
    <section
      ref={sectionRef}
      className={styles.catalog}
      aria-labelledby={headingId}
    >
      <h3 id={headingId} className={shellStyles.dialogSection}>
        Views in this browser
      </h3>
      {loading ? (
        <p role="status">Loading views…</p>
      ) : meta.packagesError ? (
        <InlineAlert tone="danger">{meta.packagesError}</InlineAlert>
      ) : meta.packages.length === 0 ? (
        <p className={componentStyles.muted}>No views kept here yet.</p>
      ) : (
        <>
          <p className={componentStyles.muted}>
            {`They take about ${packageSize(total)} of the storage saved projects use too.`}
          </p>
          <SelectableList
            aria-label="Views in this browser"
            className={styles.catalogList}
            items={meta.packages.map((pkg) => {
              const description = `Saved ${formatDateTime(pkg.createdAt)} · ${packageSize(pkg.bytes)}`
              return {
                id: pkg.id,
                title: pkg.name,
                meta: description,
                description,
              }
            })}
            selectedId={selected?.id ?? null}
            onSelect={setSelectedId}
          />
          {selected ? (
            <div className={shellStyles.dialogActions}>
              <ActionButton
                label={`Remove the view ${selected.name} from this browser`}
                disabledReason={busy ? 'A view is being removed.' : null}
                onPress={() => setRemoving(selected)}
              >
                Remove from this browser…
              </ActionButton>
            </div>
          ) : null}
        </>
      )}
      <RemoveViewDialog
        view={removing}
        onOpenChange={(open) => {
          if (!open) setRemoving(null)
        }}
        onRemoved={() => setSelectedId(null)}
        returnFocus={() =>
          sectionRef.current?.querySelector<HTMLElement>('[role="listbox"]') ??
          sectionRef.current?.querySelector<HTMLElement>('h3') ??
          null
        }
      />
    </section>
  )
}
