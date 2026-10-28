import { createStore } from 'zustand/vanilla'
import type { ProjectClient } from '../app/service/projectClient.ts'
import { MAX_PACKAGE_BYTES } from '../server/handover.ts'

// The viewer page's own UI state (decision 0032, stage 5): which package is
// being opened, why the last open failed, and whether About this handover is
// open. Packages themselves live on the mock server.

export type ViewerUiState = {
  /** The package or file being opened, while the server reads it. */
  opening: string | null
  /** Why the last open failed, shown on the package list. */
  openError: string | null
  aboutOpen: boolean
}

export const viewerStore = createStore<ViewerUiState>()(() => ({
  opening: null,
  openError: null,
  aboutOpen: false,
}))

export const PACKAGE_FILE_INPUT_ID = 'viewer-package-file'

/** Opens the browser's file chooser for a package file. */
export function pickPackageFile(): void {
  document.getElementById(PACKAGE_FILE_INPUT_ID)?.click()
}

/** Opens a package from the catalog or a file, keeping the outcome for the list. */
export async function openPackage(
  client: ProjectClient,
  from: { packageId: string; name: string } | { file: File },
): Promise<void> {
  const label = 'file' in from ? from.file.name : from.name
  viewerStore.setState({ opening: label, openError: null })
  try {
    let request: Parameters<ProjectClient['openPackage']>[0]
    if ('file' in from) {
      // Refused before reading, so a huge file is never loaded into memory.
      if (from.file.size > MAX_PACKAGE_BYTES) {
        viewerStore.setState({
          openError: `"${from.file.name}" is larger than ${MAX_PACKAGE_BYTES / 1024 / 1024} MB, too large for a handover package.`,
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
  } finally {
    viewerStore.setState({ opening: null })
  }
}
