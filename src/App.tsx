import { WorkbenchProvider } from './app/WorkbenchContext.tsx'
import { useEffect } from 'react'
import {
  useClientSnapshot,
  useWorkbenchSnapshot,
} from './app/WorkbenchContext.tsx'
import { WorkbenchShell } from './app/shell/WorkbenchShell.tsx'
import { ProjectStart } from './app/project/ProjectStart.tsx'
import { ProjectDialogs } from './app/project/ProjectDialogs.tsx'
import { DemoSwitch } from './app/shell/DemoSwitch.tsx'

function ProjectSession() {
  const snapshot = useClientSnapshot((current) => current)
  const state = useWorkbenchSnapshot((current) => current.state)
  const mustConfirmUnload =
    snapshot.meta.currentProject !== null &&
    (snapshot.meta.dirty ||
      Object.keys(state.pendingEdits).length > 0 ||
      snapshot.pending.length > 0 ||
      Object.values(state.tasks).some(
        (task) => task.status === 'running' || task.status === 'queued',
      ))
  useEffect(() => {
    if (!mustConfirmUnload) return
    const guard = (event: BeforeUnloadEvent) => {
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', guard)
    return () => window.removeEventListener('beforeunload', guard)
  }, [mustConfirmUnload])
  useEffect(() => {
    const main = document.querySelector<HTMLElement>('main')
    ;(main?.querySelector<HTMLElement>('h1') ?? main)?.focus()
  }, [snapshot.projectGeneration])
  return (
    <>
      {snapshot.meta.currentProject ? (
        <WorkbenchShell key={snapshot.projectGeneration} />
      ) : (
        <ProjectStart />
      )}
      <ProjectDialogs />
      {/* Floats over the workbench and the start screen alike (decision 0028). */}
      <DemoSwitch />
    </>
  )
}

export function App() {
  return (
    <WorkbenchProvider>
      <ProjectSession />
    </WorkbenchProvider>
  )
}
