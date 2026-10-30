import { createStore } from 'zustand/vanilla'
import type { MessageCenter } from '../app/messages/messageCenter.ts'
import type { ProjectClient } from '../app/service/projectClient.ts'
import { MAX_PACKAGE_BYTES } from '../server/handover.ts'

// The viewer page's own UI state (decision 0032, stage 5): which view is
// being opened, why the last open failed, and whether About this view is
// open. Views themselves (handover packages in storage) live on the mock
// server.

export type ViewerUiState = {
  /** The view or file being opened, while the server reads it. */
  opening: string | null
  /** Why the last open failed, shown on the start page. */
  openError: string | null
  aboutOpen: boolean
}

export const viewerStore = createStore<ViewerUiState>()(() => ({
  opening: null,
  openError: null,
  aboutOpen: false,
}))

export const PACKAGE_FILE_INPUT_ID = 'viewer-package-file'

/** Opens the browser's file chooser for a view file. */
export function pickPackageFile(): void {
  document.getElementById(PACKAGE_FILE_INPUT_ID)?.click()
}

/**
 * Opens a view from this browser's list or a file, keeping the outcome for
 * the start page. The view's warnings, such as results outdated relative to
 * the model, become messages (decision 0036), never a band that pushes the
 * workspace down.
 */
export async function openPackage(
  services: { client: ProjectClient; messages: MessageCenter },
  from: { packageId: string; name: string } | { file: File },
): Promise<void> {
  const { client, messages } = services
  const label = 'file' in from ? from.file.name : from.name
  viewerStore.setState({ opening: label, openError: null })
  try {
    let request: Parameters<ProjectClient['openPackage']>[0]
    if ('file' in from) {
      // Refused before reading, so a huge file is never loaded into memory.
      if (from.file.size > MAX_PACKAGE_BYTES) {
        viewerStore.setState({
          openError: `"${from.file.name}" is larger than ${MAX_PACKAGE_BYTES / 1024 / 1024} MB, too large for a view file.`,
        })
        return
      }
      let text: string
      try {
        text = await from.file.text()
      } catch {
        viewerStore.setState({
          openError: `"${from.file.name}" could not be read from disk.`,
        })
        return
      }
      request = { file: { name: from.file.name, text } }
    } else {
      request = { packageId: from.packageId }
    }
    const result = await client.openPackage(request)
    viewerStore.setState({
      openError:
        result.outcome.status === 'rejected'
          ? result.outcome.issues.map((issue) => issue.message).join(' ')
          : null,
    })
    const meta = client.store.getState().meta
    if (result.outcome.status === 'applied' && meta.handover) {
      for (const warning of meta.handover.warnings) {
        messages.post({
          tone: 'warning',
          source: 'project',
          projectId: meta.currentProject?.id ?? null,
          text: warning,
          toast: true,
        })
      }
    }
  } finally {
    viewerStore.setState({ opening: null })
  }
}
