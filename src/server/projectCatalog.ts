import type { WorkbenchState } from '../domain/types.ts'
import { loadProject } from './persistence.ts'
import { projectStateSchema, savedViewSchema } from './projectSchema.ts'
import { isQuotaError, storageFullMessage } from './storageQuota.ts'

export const CATALOG_KEY = 'eaui.projects.v1'
export type ProjectSummary = {
  id: string
  name: string
  savedAt: string
  lastOpenedAt: string | null
}
/**
 * What the project keeps of its views: table arrangements (decision 0029),
 * the map's layer stack (decision 0031), and its saved layouts with the one
 * it opens with (decision 0032). The UI validates them when it applies them,
 * so the server keeps them as given; projects saved before a field existed
 * simply lack it.
 */
export type SavedView = {
  tables: Record<string, unknown>
  layers?: unknown[]
  layouts?: unknown[]
  defaultLayoutId?: string | null
}
export type CatalogEntry = ProjectSummary & {
  state: WorkbenchState
  /** Absent for projects saved before views were saved with them. */
  view?: SavedView
}

/** A saved view, or null when the value is not one. */
export function parseSavedView(value: unknown): SavedView | null {
  const parsed = savedViewSchema.safeParse(value)
  if (!parsed.success) return null
  const { tables, layers, layouts, defaultLayoutId } = parsed.data
  return {
    tables,
    ...(layers ? { layers } : {}),
    ...(layouts ? { layouts } : {}),
    ...(defaultLayoutId !== undefined ? { defaultLayoutId } : {}),
  }
}
export type ProjectCatalog = { projects: CatalogEntry[] }
type WriteResult = { ok: true } | { ok: false; message: string }
const UNREADABLE =
  'The project catalog could not be read. Stored projects have not been changed.'

/** A valid catalog entry with its state migrated to the current shape, or null. */
function parseEntry(value: unknown): CatalogEntry | null {
  if (!value || typeof value !== 'object') return null
  const entry = value as Partial<CatalogEntry>
  if (
    typeof entry.id !== 'string' ||
    typeof entry.name !== 'string' ||
    typeof entry.savedAt !== 'string' ||
    (entry.lastOpenedAt !== null && typeof entry.lastOpenedAt !== 'string')
  )
    return null
  const parsed = projectStateSchema.safeParse(entry.state)
  if (
    !parsed.success ||
    parsed.data.project.id !== entry.id ||
    parsed.data.project.name !== entry.name
  )
    return null
  const view = parseSavedView(entry.view)
  return {
    id: entry.id,
    name: entry.name,
    savedAt: entry.savedAt,
    lastOpenedAt: entry.lastOpenedAt ?? null,
    state: parsed.data,
    ...(view ? { view } : {}),
  }
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
      const projects = Array.isArray(parsed?.projects)
        ? parsed.projects.map(parseEntry)
        : null
      if (
        parsed?.version !== 1 ||
        !projects ||
        projects.some((entry) => entry === null) ||
        new Set(projects.map((entry) => entry?.id)).size !== projects.length
      ) {
        return { catalog: empty, error: UNREADABLE }
      }
      return {
        catalog: { projects: projects.filter((entry) => entry !== null) },
        error: null,
      }
    }
    const legacy = loadProject(storage)
    if (!legacy) {
      return {
        catalog: empty,
        error: storage.getItem('eaui.project.v2') === null ? null : UNREADABLE,
      }
    }
    const { id, name } = legacy.state.project
    const migrated = parseEntry({
      id,
      name,
      state: legacy.state,
      savedAt: legacy.savedAt,
      lastOpenedAt: null,
    })
    return migrated
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
    // Handover packages share this storage (decision 0032, stage 5).
    if (isQuotaError(error)) {
      return {
        ok: false,
        message: storageFullMessage('the project was not saved', storage),
      }
    }
    return {
      ok: false,
      message: `Saving failed: ${error instanceof Error ? error.message : String(error)}`,
    }
  }
}

export const INTERRUPTED =
  'Interrupted when the project session was closed. Interrupted work does not restart; start a fresh run.'

/**
 * A saved running job cannot resume after this in-page server has restarted:
 * it is interrupted and its run closed to retries. A finished partial run
 * stays retryable while its captured inputs still match.
 */
export function restoreProject(entry: CatalogEntry): WorkbenchState {
  const state = structuredClone(entry.state)
  for (const task of Object.values(state.tasks)) {
    task.log ??= []
    if (task.status === 'queued' || task.status === 'running') {
      task.status = 'cancelled'
      task.message = INTERRUPTED
      task.log.push({ at: task.updatedAt, message: INTERRUPTED })
      const group = task.groupId ? state.runGroups[task.groupId] : undefined
      if (group?.status === 'open') {
        group.status = 'cancelled'
        group.statusReason = 'This run was interrupted when the project closed.'
        group.held = {}
      }
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
