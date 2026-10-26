import type { WorkbenchState } from '../domain/types.ts'
import { loadProject } from './persistence.ts'
import { projectStateSchema } from './projectSchema.ts'

export const CATALOG_KEY = 'eaui.projects.v1'
export type ProjectSummary = {
  id: string
  name: string
  savedAt: string
  lastOpenedAt: string | null
}
export type CatalogEntry = ProjectSummary & { state: WorkbenchState }
export type ProjectCatalog = { projects: CatalogEntry[] }
type WriteResult = { ok: true } | { ok: false; message: string }
const UNREADABLE =
  'The project catalog could not be read. Stored projects have not been changed.'

function isEntry(value: unknown): value is CatalogEntry {
  if (!value || typeof value !== 'object') return false
  const entry = value as Partial<CatalogEntry>
  return (
    typeof entry.id === 'string' &&
    typeof entry.name === 'string' &&
    typeof entry.savedAt === 'string' &&
    (entry.lastOpenedAt === null || typeof entry.lastOpenedAt === 'string') &&
    projectStateSchema.safeParse(entry.state).success &&
    entry.state?.project.id === entry.id &&
    entry.state.project.name === entry.name
  )
}

export function readProjectCatalog(storage: Storage | null): {
  catalog: ProjectCatalog
  error: string | null
} {
  const empty: ProjectCatalog = { projects: [] }
  if (!storage)
    return {
      catalog: empty,
      error: 'Browser storage is unavailable. Projects cannot be saved here.',
    }
  try {
    const raw = storage.getItem(CATALOG_KEY)
    if (raw !== null) {
      const parsed = JSON.parse(raw) as {
        version?: unknown
        projects?: unknown
      }
      if (
        parsed?.version !== 1 ||
        !Array.isArray(parsed.projects) ||
        !parsed.projects.every(isEntry) ||
        new Set(parsed.projects.map((entry) => entry.id)).size !==
          parsed.projects.length
      ) {
        return { catalog: empty, error: UNREADABLE }
      }
      return { catalog: { projects: parsed.projects }, error: null }
    }
    const legacy = loadProject(storage)
    if (!legacy) {
      return {
        catalog: empty,
        error: storage.getItem('eaui.project.v2') === null ? null : UNREADABLE,
      }
    }
    const { id, name } = legacy.state.project
    const migrated: CatalogEntry = {
      id,
      name,
      state: legacy.state,
      savedAt: legacy.savedAt,
      lastOpenedAt: null,
    }
    return isEntry(migrated)
      ? { catalog: { projects: [migrated] }, error: null }
      : { catalog: empty, error: UNREADABLE }
  } catch {
    return { catalog: empty, error: UNREADABLE }
  }
}

export function writeProjectCatalog(
  storage: Storage | null,
  catalog: ProjectCatalog,
): WriteResult {
  if (!storage)
    return {
      ok: false,
      message:
        'Browser storage is unavailable, so the project cannot be saved here.',
    }
  try {
    storage.setItem(
      CATALOG_KEY,
      JSON.stringify({ version: 1, projects: catalog.projects }),
    )
    return { ok: true }
  } catch (error) {
    return {
      ok: false,
      message: `Saving failed: ${error instanceof Error ? error.message : String(error)}`,
    }
  }
}

/** A saved running job cannot resume after this in-page server has restarted. */
export function restoreProject(entry: CatalogEntry): WorkbenchState {
  const state = structuredClone(entry.state)
  for (const task of Object.values(state.tasks)) {
    task.log ??= []
    if (task.status === 'queued' || task.status === 'running') {
      task.status = 'cancelled'
      task.message = 'Interrupted when the project session was closed.'
    }
  }
  return {
    ...state,
    selection: { entityType: null, ids: [] },
    pendingEdits: {},
    workflow: { ...state.workflow, currentStageId: null },
  }
}

export function projectSummaries(catalog: ProjectCatalog): ProjectSummary[] {
  return catalog.projects
    .map(({ id, name, savedAt, lastOpenedAt }) => ({
      id,
      name,
      savedAt,
      lastOpenedAt,
    }))
    .sort((a, b) =>
      (b.lastOpenedAt ?? b.savedAt).localeCompare(a.lastOpenedAt ?? a.savedAt),
    )
}
