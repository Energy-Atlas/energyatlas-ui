import { TriangleAlert } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Button } from 'react-aria-components'
import { useStore } from 'zustand'
import type { PackageSummary } from '../server/handover.ts'
import { useClientSnapshot, useServices } from '../app/WorkbenchContext.tsx'
import { useInvokeAction } from '../app/actions.ts'
import { ActionButton } from '../app/components/ActionButton.tsx'
import componentStyles from '../app/components/components.module.css'
import { HandoverSummary } from '../app/components/HandoverSummary.tsx'
import { InlineAlert } from '../app/components/InlineAlert.tsx'
import { SelectableList } from '../app/components/SelectableList.tsx'
import { formatCount, formatDateTime } from '../app/format.ts'
import { RemoveViewDialog } from '../app/handover/ViewsInBrowser.tsx'
import projectStyles from '../app/project/project.module.css'
import { StartScreen, StartSection } from '../app/project/StartScreen.tsx'
import { Ribbon } from '../app/shell/Ribbon.tsx'
import { ShellDialogHost } from '../app/shell/ShellDialogHost.tsx'
import { useShellDialogs } from '../app/shell/useShellDialogs.ts'
import { useShortcuts } from '../app/useShortcuts.ts'
import { HANDOVER_CATALOG_KEY } from '../server/handoverCatalog.ts'
import { forViewerStart, useViewerActions } from './viewerActions.ts'
import { openPackage, pickPackageFile, viewerStore } from './viewerStore.ts'
import styles from './viewer.module.css'

/** Lists longer than this get a search field. */
const SEARCH_FROM = 6

/** The view a link from the modeller asks for (`?package=<id>`), once. */
function requestedPackage(): string | null {
  return new URLSearchParams(window.location.search).get('package')
}

/**
 * The viewer's start page (decision 0036; it replaced the package list of
 * decision 0032, stage 5): the start screen's layout with viewer wording. It
 * opens views only: one kept in this browser, or a view file.
 */
export function ViewerStart() {
  const { client, messages } = useServices()
  const meta = useClientSnapshot((snapshot) => snapshot.meta)
  const pending = useClientSnapshot((snapshot) => snapshot.pending)
  const { opening, openError } = useStore(viewerStore)
  const { open, dialogs, onOpenChange } = useShellDialogs()
  const actions = forViewerStart(useViewerActions(dialogs))
  const invoke = useInvokeAction()
  useShortcuts(actions, invoke)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [removing, setRemoving] = useState<PackageSummary | null>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const services = { client, messages }

  const listed = useRef(false)
  useEffect(() => {
    if (listed.current) return
    listed.current = true
    void client.listPackages().then(() => {
      // A link from the modeller's Save as opens its view at once.
      const wanted = requestedPackage()
      const found = client.store
        .getState()
        .meta.packages.find((pkg) => pkg.id === wanted)
      if (wanted) {
        window.history.replaceState(null, '', window.location.pathname)
      }
      if (found) {
        void openPackage(
          { client, messages },
          { packageId: found.id, name: found.name },
        )
      } else if (wanted) {
        viewerStore.setState({
          openError:
            'The view the link names is not in this browser any more. Choose another, or open it from a file.',
        })
      }
    })
  }, [client, messages])

  // A view saved in another tab appears without a reload.
  useEffect(() => {
    const refresh = () => {
      if (client.store.getState().pending.length === 0) {
        void client.listPackages()
      }
    }
    const onStorage = (event: StorageEvent) => {
      if (event.key === null || event.key === HANDOVER_CATALOG_KEY) refresh()
    }
    window.addEventListener('storage', onStorage)
    window.addEventListener('focus', refresh)
    return () => {
      window.removeEventListener('storage', onStorage)
      window.removeEventListener('focus', refresh)
    }
  }, [client])

  // Only the first read hides the lists: a refresh (another tab, focus) keeps
  // them, so a control that has focus or opened a dialog never disappears.
  const loading = !meta.packagesReady
  const busy = opening !== null || pending.length > 0
  const busyReason = opening
    ? `Wait for "${opening}" to open.`
    : busy
      ? 'Wait for the server to answer: the list of views is loading or a view is being removed.'
      : null
  const selected =
    meta.packages.find((pkg) => pkg.id === selectedId) ??
    meta.packages[0] ??
    null

  return (
    <StartScreen
      ribbon={
        <Ribbon actions={actions} invoke={invoke} projectHeading={false} />
      }
      title="Views"
      intro="A view is a frozen, view-only copy of a project: its published model and results, layouts, and provenance. Choose a view kept in this browser or open a view file to explore it on the map, table, dashboard, and results; nothing here changes the model."
      buttons={
        <ActionButton
          variant="primary"
          label="Open view file…"
          disabledReason={busyReason}
          onPress={pickPackageFile}
        >
          Open view file…
        </ActionButton>
      }
      notice={
        <>
          {opening ? (
            <p role="status" className={styles.opening}>
              Opening &ldquo;{opening}&rdquo;…
            </p>
          ) : null}
          {openError ? (
            <InlineAlert tone="danger" title="The view was not opened">
              {`${openError} Choose the view again to retry, or change Demo conditions.`}
            </InlineAlert>
          ) : null}
        </>
      }
      after={
        <>
          <RemoveViewDialog
            view={removing}
            onOpenChange={(isOpen) => {
              if (!isOpen) setRemoving(null)
            }}
            onRemoved={() => setSelectedId(null)}
            // The list once the removed view is gone, or the page heading
            // when no view is left.
            returnFocus={() =>
              listRef.current?.querySelector<HTMLElement>('[role="listbox"]') ??
              document.querySelector<HTMLElement>('main h1')
            }
          />
          <ShellDialogHost
            open={open}
            onOpenChange={onOpenChange}
            actions={actions}
            invoke={invoke}
          />
        </>
      }
    >
      <StartSection title="Views in this browser">
        {loading ? (
          <p role="status">Loading views…</p>
        ) : (
          <div ref={listRef} className={styles.listArea}>
            {meta.packagesError ? (
              <InlineAlert
                tone="danger"
                actions={
                  <Button
                    className={componentStyles.button}
                    onPress={() => void client.listPackages()}
                  >
                    Try loading views again
                  </Button>
                }
              >
                {meta.packagesError}
              </InlineAlert>
            ) : null}
            {meta.unreadablePackages > 0 ? (
              <InlineAlert tone="warning">
                {`${formatCount(meta.unreadablePackages, 'stored view')} could not be read by this version and ${meta.unreadablePackages === 1 ? 'is' : 'are'} kept unchanged.`}
              </InlineAlert>
            ) : null}
            <SelectableList
              aria-label="Views in this browser"
              className={projectStyles.projects}
              items={meta.packages.map((pkg) => {
                const description = [
                  `Saved ${formatDateTime(pkg.createdAt)}`,
                  formatCount(pkg.buildings, 'building'),
                  formatCount(pkg.results, 'result'),
                  pkg.warnings.length > 0
                    ? formatCount(pkg.warnings.length, 'warning')
                    : null,
                ]
                  .filter(Boolean)
                  .join(' · ')
                return {
                  id: pkg.id,
                  title: pkg.name,
                  status:
                    pkg.warnings.length > 0 ? (
                      <TriangleAlert
                        size={14}
                        role="img"
                        aria-label="Has warnings"
                        className={styles.warningIcon}
                      />
                    ) : undefined,
                  meta: description,
                  description,
                }
              })}
              selectedId={selected?.id ?? null}
              onSelect={setSelectedId}
              onAction={(id) => {
                const pkg = meta.packages.find((each) => each.id === id)
                if (pkg) {
                  void openPackage(services, {
                    packageId: pkg.id,
                    name: pkg.name,
                  })
                }
              }}
              disabledReason={busyReason}
              search={
                meta.packages.length >= SEARCH_FROM
                  ? { label: 'Search views', placeholder: 'Search views' }
                  : undefined
              }
              empty={
                <p className={componentStyles.empty}>
                  {meta.packagesError
                    ? 'No views can be listed until the list is read. Try loading them again, or open a view file someone sent you.'
                    : 'No views in this browser yet. In the modeller, choose File > Save as… > View, or open a view file someone sent you.'}
                </p>
              }
            />
          </div>
        )}
      </StartSection>
      <StartSection title={selected && !loading ? selected.name : 'View'}>
        {selected && !loading ? (
          <>
            <HandoverSummary
              createdAt={selected.createdAt}
              provenance={selected.provenance}
              warnings={selected.warnings}
            />
            <div className={projectStyles.actions}>
              <ActionButton
                variant="primary"
                label={`Open the view ${selected.name}`}
                disabledReason={busyReason}
                onPress={() =>
                  void openPackage(services, {
                    packageId: selected.id,
                    name: selected.name,
                  })
                }
              >
                Open view
              </ActionButton>
              <ActionButton
                label={`Remove the view ${selected.name} from this browser`}
                disabledReason={busyReason}
                onPress={() => setRemoving(selected)}
              >
                Remove from this browser…
              </ActionButton>
            </div>
          </>
        ) : (
          <p className={componentStyles.muted}>
            {loading
              ? 'A view’s provenance shows here once the list is read.'
              : 'Choose a view to see where it came from, or open a view file.'}
          </p>
        )}
      </StartSection>
    </StartScreen>
  )
}
