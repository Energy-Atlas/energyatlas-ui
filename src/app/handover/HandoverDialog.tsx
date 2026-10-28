import { useMemo } from 'react'
import { useStore } from 'zustand'
import { packageWarnings } from '../../server/handover.ts'
import {
  useClientSnapshot,
  useServices,
  useUnsavedChanges,
  useWorkbenchSnapshot,
} from '../WorkbenchContext.tsx'
import { formatDateTime } from '../format.ts'
import { ActionButton } from '../components/ActionButton.tsx'
import { HandoverSummary } from '../components/HandoverSummary.tsx'
import { InlineAlert } from '../components/InlineAlert.tsx'
import componentStyles from '../components/components.module.css'
import { cx } from '../cx.ts'
import { DialogFrame } from '../shell/HelpDialogs.tsx'
import shellStyles from '../shell/shell.module.css'
import { viewerUrl } from './handoverService.ts'
import { CatalogPackages } from './CatalogPackages.tsx'
import styles from './handover.module.css'

/**
 * File > Hand over (decision 0032, stage 5): says what a handover package
 * holds and leaves out, freezes the copy saved in this browser, and then
 * offers the viewer page and the package file.
 */
export function HandoverDialog() {
  const { handover } = useServices()
  const snapshot = useStore(handover.store)
  const state = useWorkbenchSnapshot((current) => current.state)
  // Re-evaluated when requests start or finish, which can block a handover.
  useClientSnapshot((current) => current.pending.length)
  const blocker = snapshot.busy ? null : handover.blocker()
  const drafts = Object.keys(state.pendingEdits).length
  const savedAt = useClientSnapshot((current) => current.meta.savedAt)
  const unsaved = useUnsavedChanges() || drafts > 0
  // With unsaved changes the current model is not what the package holds, so
  // its warnings are shown once the package is made.
  const warnings = useMemo(
    () => (unsaved ? [] : packageWarnings({ model: state })),
    [state, unsaved],
  )
  const done = snapshot.last
  const error = snapshot.issues.map((issue) => issue.message).join(' ')

  return (
    <DialogFrame
      title={done ? 'Handed over' : 'Hand over this project'}
      isOpen={snapshot.open}
      onOpenChange={(open) => {
        if (!open) handover.closeDialog()
      }}
      isBusy={snapshot.busy}
    >
      {done ? (
        <>
          {done.storeError ? (
            <InlineAlert tone="warning" title="Not kept in this browser">
              {done.storeError}
            </InlineAlert>
          ) : (
            <InlineAlert tone="success" live="polite">
              {`"${done.package.name}" is in this browser's handover catalog. The viewer page lists it; download it to hand it to someone else.`}
            </InlineAlert>
          )}
          <HandoverSummary
            createdAt={done.package.createdAt}
            provenance={done.package.provenance}
            warnings={packageWarnings(done.package)}
          />
          <div className={shellStyles.dialogActions}>
            <ActionButton
              label={`Download the handover package of ${done.package.name}`}
              disabledReason={null}
              onPress={() => handover.download(done.package)}
            >
              Download package
            </ActionButton>
            {done.storeError ? null : (
              <a
                className={cx(componentStyles.button, componentStyles.primary)}
                href={viewerUrl(done.package.id)}
                target="_blank"
                rel="noopener"
              >
                Open in the viewer
              </a>
            )}
          </div>
        </>
      ) : (
        <>
          <p className={styles.lead}>
            A handover package is a frozen, view-only copy of this project as
            saved in this browser, for the viewer page: the published model and
            its current results, the table settings, map layers, and project
            layouts, and where they came from.
          </p>
          <ul className={styles.facts}>
            <li>
              Left out: held job outputs, job logs, unsent drafts, and changes
              not saved in this browser.
            </li>
            <li>
              Result versions are not kept yet, so the package carries the
              current published results only.
            </li>
            <li>
              The package stays in this browser&rsquo;s handover catalog and can
              be downloaded as a file for the viewer to open.
            </li>
          </ul>
          {warnings.length > 0 ? (
            <InlineAlert tone="warning" title="The package will warn">
              <ul className={styles.facts}>
                {warnings.map((warning) => (
                  <li key={warning}>{warning}</li>
                ))}
              </ul>
            </InlineAlert>
          ) : null}
          {savedAt && unsaved && !blocker ? (
            <InlineAlert tone="warning" title="Unsaved changes stay out">
              {`The package holds the copy saved ${formatDateTime(savedAt)}${drafts > 0 ? `; ${drafts} unsent draft${drafts === 1 ? '' : 's'} here and` : ';'} changes made since are not in it. Save first (File > Save, Ctrl+S) to include them.`}
            </InlineAlert>
          ) : null}
          {blocker && !error ? (
            <InlineAlert tone="info">{blocker}</InlineAlert>
          ) : null}
          {error ? <InlineAlert tone="danger">{error}</InlineAlert> : null}
          <div className={shellStyles.dialogActions}>
            <ActionButton
              label="Cancel the handover"
              disabledReason={
                snapshot.busy ? 'The package is being prepared.' : null
              }
              onPress={() => handover.closeDialog()}
            >
              Cancel
            </ActionButton>
            <ActionButton
              label="Hand over the project"
              variant="primary"
              disabledReason={
                snapshot.busy ? 'The package is being prepared.' : blocker
              }
              onPress={() => void handover.handOver()}
            >
              {snapshot.busy ? 'Preparing…' : 'Hand over'}
            </ActionButton>
          </div>
        </>
      )}
      <CatalogPackages />
    </DialogFrame>
  )
}
