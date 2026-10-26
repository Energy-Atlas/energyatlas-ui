import type { WorkbenchState } from '../domain/types.ts'

// The prototype's "save": the project model is stored in this browser only.
// There is no server, no file, and nothing shared between browsers.

// Version 2 holds the Back Bay OpenStreetMap footprints (decision 0012).
// Version 1 projects used the synthetic ocean grid; they are left in storage
// but not restored.
const PROJECT_KEY = 'eaui.project.v2'
const OUTDATED_PROJECT_KEY = 'eaui.project.v1'

type SavedProject = { version: 2; savedAt: string; state: WorkbenchState }

export type SaveResult =
  { ok: true; savedAt: string } | { ok: false; message: string }

export function saveProject(
  storage: Storage | null,
  state: WorkbenchState,
  now: Date,
): SaveResult {
  if (!storage) {
    return {
      ok: false,
      message:
        'Browser storage is unavailable, so the project cannot be saved here.',
    }
  }
  const saved: SavedProject = {
    version: 2,
    savedAt: now.toISOString(),
    state,
  }
  try {
    storage.setItem(PROJECT_KEY, JSON.stringify(saved))
    return { ok: true, savedAt: saved.savedAt }
  } catch (error) {
    return {
      ok: false,
      message: `Saving failed: ${error instanceof Error ? error.message : String(error)}`,
    }
  }
}

function isSavedProject(value: unknown): value is SavedProject {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as Partial<SavedProject>
  return (
    candidate.version === 2 &&
    typeof candidate.savedAt === 'string' &&
    typeof candidate.state === 'object' &&
    candidate.state !== null &&
    typeof candidate.state.workflow === 'object' &&
    typeof candidate.state.assets === 'object'
  )
}

/** Loads the saved project; tasks still active when the page closed are marked cancelled. */
export function loadProject(storage: Storage | null): SavedProject | null {
  if (!storage) return null
  let parsed: unknown
  try {
    const raw = storage.getItem(PROJECT_KEY)
    if (!raw) return null
    parsed = JSON.parse(raw)
  } catch {
    return null
  }
  if (!isSavedProject(parsed)) return null
  for (const task of Object.values(parsed.state.tasks)) {
    // Projects saved before jobs kept a log have none.
    task.log ??= []
    if (task.status === 'queued' || task.status === 'running') {
      task.status = 'cancelled'
      task.message = 'Interrupted when the page was closed.'
    }
  }
  return parsed
}

/** True when this browser holds a project saved before decision 0012, which is not restored. */
export function hasOutdatedProject(storage: Storage | null): boolean {
  try {
    return Boolean(storage?.getItem(OUTDATED_PROJECT_KEY))
  } catch {
    return false
  }
}
