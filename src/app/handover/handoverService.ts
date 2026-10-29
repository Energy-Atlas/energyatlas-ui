import { createStore, type StoreApi } from 'zustand/vanilla'
import type { ValidationIssue } from '../../domain/commands.ts'
import type { CommandSource } from '../../domain/types.ts'
import type { Workbench } from '../../domain/workbench.ts'
import {
  handoverBlocker,
  NOT_SAVED_FOR_HANDOVER,
  packageFileName,
  type HandoverPackage,
} from '../../server/handover.ts'
import { downloadText } from '../csv.ts'
import type { ProjectClient } from '../service/projectClient.ts'

// Hand over (decision 0032, stage 5): one service for the File menu, the
// Hand over dialog, the palette, and the agent. It freezes the copy of the
// open project saved in this browser into a view-only package through the
// project client (the owner's choice: unsaved changes stay out), keeps the
// result for the dialog, and downloads a package as a file.

export type HandoverSnapshot = {
  /** The dialog is open. */
  open: boolean
  busy: boolean
  /** The package the last Hand over made, and whether the catalog kept it. */
  last: { package: HandoverPackage; storeError: string | null } | null
  issues: ValidationIssue[]
}

export type HandoverService = {
  store: StoreApi<HandoverSnapshot>
  openDialog: () => void
  closeDialog: () => void
  /** Why Hand over cannot run now, or null. */
  blocker: () => string | null
  /** The open project has changes the saved copy, and so a package, lacks. */
  unsaved: () => boolean
  handOver: (source?: CommandSource) => Promise<HandoverSnapshot>
  /** Downloads a package as a JSON file the viewer page opens. */
  download: (pkg: HandoverPackage, source?: CommandSource) => void
}

/** The viewer page beside the modeller, under the same base path. */
export function viewerUrl(packageId?: string): string {
  const base = `${import.meta.env.BASE_URL}viewer.html`
  return packageId ? `${base}?package=${encodeURIComponent(packageId)}` : base
}

export function createHandoverService(options: {
  client: ProjectClient
  workbench: Workbench
  /** Views saved with the project, such as tables, changed since saving. */
  viewUnsaved?: () => boolean
}): HandoverService {
  const { client, workbench, viewUnsaved = () => false } = options
  const unsaved = () =>
    client.store.getState().meta.dirty ||
    viewUnsaved() ||
    Object.keys(workbench.getState().pendingEdits).length > 0
  const store = createStore<HandoverSnapshot>()(() => ({
    open: false,
    busy: false,
    last: null,
    issues: [],
  }))

  const blocker = (): string | null => {
    const snapshot = client.store.getState()
    if (snapshot.meta.viewOnly) {
      return 'This is the view-only viewer; only the modeller hands projects over.'
    }
    if (!snapshot.meta.currentProject) return 'Open or create a project first.'
    if (snapshot.transitioning) {
      return 'The project session is changing. Wait for it to finish.'
    }
    if (store.getState().busy) return 'A handover is already being prepared.'
    if (snapshot.pending.length > 0) {
      return 'Waiting for the server to answer earlier requests. Hand over once they finish.'
    }
    if (!snapshot.meta.savedAt) return NOT_SAVED_FOR_HANDOVER
    // With nothing unsaved the saved copy is the current model, so its
    // blockers can be named before the server is asked.
    return unsaved() ? null : handoverBlocker(workbench.getState(), 'saved')
  }

  return {
    store,
    openDialog: () =>
      store.setState({ open: true, last: null, issues: [], busy: false }),
    closeDialog: () => store.setState({ open: false }),
    blocker,
    unsaved,
    async handOver(source = 'manual') {
      const reason = blocker()
      if (reason) {
        workbench.record({
          type: 'project.handover',
          title: 'Hand over project',
          source,
          status: 'rejected',
          summary: '',
          issues: [{ path: '', message: reason }],
        })
        store.setState({ issues: [{ path: '', message: reason }] })
        return store.getState()
      }
      store.setState({ busy: true, issues: [], last: null })
      try {
        const handed = await client.handOver(source, {
          viewUnsaved: viewUnsaved(),
        })
        store.setState({
          last: handed.package
            ? { package: handed.package, storeError: handed.storeError }
            : null,
          issues:
            handed.result.outcome.status === 'rejected'
              ? handed.result.outcome.issues
              : [],
        })
      } finally {
        // A failed request must not leave Hand over unavailable for good.
        store.setState({ busy: false })
      }
      return store.getState()
    },
    download(pkg, source = 'manual') {
      const name = packageFileName(pkg)
      downloadText(name, JSON.stringify(pkg), 'application/json')
      workbench.record({
        type: 'handover.download',
        title: 'Download handover package',
        input: { packageId: pkg.id },
        source,
        summary: `Downloaded the handover package "${pkg.name}" as ${name}. Open it on the viewer page with Open package file.`,
      })
    },
  }
}
