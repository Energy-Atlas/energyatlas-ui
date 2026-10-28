import { TriangleAlert } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Button } from 'react-aria-components'
import { useStore } from 'zustand'
import { useClientSnapshot, useServices } from '../app/WorkbenchContext.tsx'
import { useInvokeAction } from '../app/actions.ts'
import componentStyles from '../app/components/components.module.css'
import {
  HandoverSummary,
  ViewOnlyBadge,
} from '../app/components/HandoverSummary.tsx'
import { InlineAlert } from '../app/components/InlineAlert.tsx'
import { SelectableList } from '../app/components/SelectableList.tsx'
import { cx } from '../app/cx.ts'
import { formatCount, formatDateTime } from '../app/format.ts'
import projectStyles from '../app/project/project.module.css'
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

/** The package a link from the modeller asks for (`?package=<id>`), once. */
function requestedPackage(): string | null {
  return new URLSearchParams(window.location.search).get('package')
}

/**
 * The viewer's start screen (decision 0032, stage 5): the handover packages
 * in this browser's catalog, a package's provenance and warnings, and Open
 * package file. Opening one enters the view-only shell.
 */
export function ViewerStart() {
  const { client } = useServices()
  const meta = useClientSnapshot((snapshot) => snapshot.meta)
  const pending = useClientSnapshot((snapshot) => snapshot.pending)
  const { opening, openError } = useStore(viewerStore)
  const { open, dialogs, onOpenChange } = useShellDialogs()
  const actions = forViewerStart(useViewerActions(dialogs))
  const invoke = useInvokeAction()
  useShortcuts(actions, invoke)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [confirmRemove, setConfirmRemove] = useState(false)
  const [removeError, setRemoveError] = useState<string | null>(null)

  const listed = useRef(false)
  useEffect(() => {
    if (listed.current) return
    listed.current = true
    void client.listPackages().then(() => {
      // A link from the modeller's Hand over opens its package at once.
      const wanted = requestedPackage()
      const found = client.store
        .getState()
        .meta.packages.find((pkg) => pkg.id === wanted)
      if (wanted) {
        window.history.replaceState(null, '', window.location.pathname)
      }
      if (found) {
        void openPackage(client, { packageId: found.id, name: found.name })
      } else if (wanted) {
        viewerStore.setState({
          openError:
            'The package the link names is not in this browser any more. Choose another, or open it from a file.',
        })
      }
    })
  }, [client])

  // A package handed over in another tab appears without a reload.
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

  const loading =
    !meta.packagesReady ||
    pending.some((request) => request.type === 'handover.list')
  const busy = opening !== null || pending.length > 0
  const busyReason = busy ? 'Wait for the package being opened.' : null
  const selected =
    meta.packages.find((pkg) => pkg.id === selectedId) ??
    meta.packages[0] ??
    null

  return (
    <div className={projectStyles.start}>
      <Ribbon
        actions={actions}
        invoke={invoke}
        projectHeading={false}
        badge={<ViewOnlyBadge />}
      />
      <main
        className={cx(projectStyles.content, styles.startContent)}
        aria-labelledby="packages-heading"
        tabIndex={-1}
      >
        <h1 id="packages-heading" tabIndex={-1}>
          Handover packages
        </h1>
        <p>
          A handover package is a frozen, view-only copy of a project: its
          published model and results, layouts, and provenance. Explore it on
          the map, table, dashboard, and results; nothing here changes the
          model.
        </p>
        <div className={projectStyles.actions}>
          <Button
            className={cx(componentStyles.button, componentStyles.primary)}
            isDisabled={busy}
            onPress={pickPackageFile}
          >
            Open package file…
          </Button>
        </div>
        {opening ? (
          <p role="status" className={styles.opening}>
            Opening &ldquo;{opening}&rdquo;…
          </p>
        ) : null}
        {openError ? (
          <InlineAlert
            tone="danger"
            title="The package was not opened"
            actions={
              <Button
                className={componentStyles.button}
                onPress={() => viewerStore.setState({ openError: null })}
              >
                Dismiss
              </Button>
            }
          >
            {openError}
          </InlineAlert>
        ) : null}
        <div className={styles.columns}>
          <section
            className={projectStyles.section}
            aria-labelledby="catalog-heading"
          >
            <h2 id="catalog-heading" className={projectStyles.sectionHeading}>
              In this browser
            </h2>
            {loading ? (
              <p role="status">Loading handover packages…</p>
            ) : (
              <>
                {meta.packagesError ? (
                  <InlineAlert
                    tone="danger"
                    actions={
                      <Button
                        className={componentStyles.button}
                        onPress={() => void client.listPackages()}
                      >
                        Try loading packages again
                      </Button>
                    }
                  >
                    {meta.packagesError}
                  </InlineAlert>
                ) : null}
                {meta.unreadablePackages > 0 ? (
                  <InlineAlert tone="warning">
                    {`${formatCount(meta.unreadablePackages, 'stored package')} could not be read by this version and ${meta.unreadablePackages === 1 ? 'is' : 'are'} kept unchanged.`}
                  </InlineAlert>
                ) : null}
                <SelectableList
                  aria-label="Handover packages"
                  className={projectStyles.projects}
                  items={meta.packages.map((pkg) => {
                    const description = [
                      `Handed over ${formatDateTime(pkg.createdAt)}`,
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
                  onSelect={(id) => {
                    setSelectedId(id)
                    setConfirmRemove(false)
                    setRemoveError(null)
                  }}
                  onAction={(id) => {
                    const pkg = meta.packages.find((each) => each.id === id)
                    if (pkg) {
                      void openPackage(client, {
                        packageId: pkg.id,
                        name: pkg.name,
                      })
                    }
                  }}
                  disabledReason={busyReason}
                  search={
                    meta.packages.length >= SEARCH_FROM
                      ? {
                          label: 'Search handover packages',
                          placeholder: 'Search packages',
                        }
                      : undefined
                  }
                  empty={
                    meta.packagesError ? null : (
                      <p className={componentStyles.empty}>
                        No handover packages in this browser yet. In the
                        modeller, choose File &gt; Hand over…, or open a package
                        file someone sent you.
                      </p>
                    )
                  }
                />
              </>
            )}
          </section>
          {selected && !loading ? (
            <section
              className={projectStyles.section}
              aria-labelledby="package-heading"
            >
              <h2 id="package-heading" className={projectStyles.sectionHeading}>
                {selected.name}
              </h2>
              <HandoverSummary
                createdAt={selected.createdAt}
                provenance={selected.provenance}
                warnings={selected.warnings}
              />
              {removeError ? (
                <InlineAlert tone="danger">{removeError}</InlineAlert>
              ) : null}
              {confirmRemove ? (
                <InlineAlert
                  tone="warning"
                  title={`Remove "${selected.name}" from this browser?`}
                  actions={
                    <>
                      <Button
                        className={componentStyles.button}
                        autoFocus
                        onPress={() => setConfirmRemove(false)}
                      >
                        Keep it
                      </Button>
                      <Button
                        className={cx(
                          componentStyles.button,
                          componentStyles.primary,
                        )}
                        isDisabled={busy}
                        onPress={() => {
                          void client
                            .removePackage(selected.id)
                            .then((result) => {
                              setConfirmRemove(false)
                              setRemoveError(
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
                  Downloaded copies of the package are not affected.
                </InlineAlert>
              ) : null}
              <div className={projectStyles.actions}>
                <Button
                  className={cx(
                    componentStyles.button,
                    componentStyles.primary,
                  )}
                  isDisabled={busy}
                  onPress={() =>
                    void openPackage(client, {
                      packageId: selected.id,
                      name: selected.name,
                    })
                  }
                >
                  Open package
                </Button>
                <Button
                  className={componentStyles.button}
                  isDisabled={busy || confirmRemove}
                  onPress={() => setConfirmRemove(true)}
                >
                  Remove from this browser…
                </Button>
              </div>
            </section>
          ) : null}
        </div>
      </main>
      <ShellDialogHost
        open={open}
        onOpenChange={onOpenChange}
        actions={actions}
        invoke={invoke}
      />
    </div>
  )
}
