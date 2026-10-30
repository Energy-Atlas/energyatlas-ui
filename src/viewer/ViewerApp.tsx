import { useEffect } from 'react'
import {
  useClientSnapshot,
  useServices,
  WorkbenchProvider,
} from '../app/WorkbenchContext.tsx'
import { DemoSwitch } from '../app/shell/DemoSwitch.tsx'
import { ViewerShell } from './ViewerShell.tsx'
import { ViewerStart } from './ViewerStart.tsx'
import { openPackage, PACKAGE_FILE_INPUT_ID } from './viewerStore.ts'

/**
 * The browser's file chooser for view files, shared by the start page and
 * the shell's File menu so Open view file works from both.
 */
function PackageFileInput() {
  const { client, messages } = useServices()
  return (
    <input
      id={PACKAGE_FILE_INPUT_ID}
      type="file"
      accept=".json,application/json"
      className="visually-hidden"
      tabIndex={-1}
      aria-label="View file"
      onChange={(event) => {
        const file = event.currentTarget.files?.[0]
        // Choosing the same file again must fire again.
        event.currentTarget.value = ''
        if (file) void openPackage({ client, messages }, { file })
      }}
    />
  )
}

function ViewerSession() {
  const snapshot = useClientSnapshot((current) => current)
  useEffect(() => {
    const main = document.querySelector<HTMLElement>('main')
    ;(main?.querySelector<HTMLElement>('h1') ?? main)?.focus()
  }, [snapshot.projectGeneration])
  return (
    <>
      {snapshot.meta.currentProject ? (
        <ViewerShell key={snapshot.projectGeneration} />
      ) : (
        <ViewerStart />
      )}
      <PackageFileInput />
      <DemoSwitch />
    </>
  )
}

/** The view-only viewer page (decision 0032, stage 5). */
export function ViewerApp() {
  return (
    <WorkbenchProvider mode="viewer">
      <ViewerSession />
    </WorkbenchProvider>
  )
}
