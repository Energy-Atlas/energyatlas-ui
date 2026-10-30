import {
  readHandoverPackage,
  summarizePackage,
  type HandoverPackage,
  type PackageSummary,
} from './handover.ts'
import { HANDOVER_CATALOG_KEY, isQuotaError } from './storageQuota.ts'

export { HANDOVER_CATALOG_KEY }

// The browser catalog of handover packages (decision 0032, stage 5): "Hand
// over" in the modeller adds a package, and the viewer page lists and opens
// them. Like the project catalog, a stored value that cannot be read is never
// overwritten silently, and single unreadable entries are kept as stored.

export type HandoverCatalog = {
  packages: HandoverPackage[]
  /** Stored entries this version cannot read, written back unchanged. */
  unreadable: unknown[]
}

export const CATALOG_UNAVAILABLE =
  'Browser storage is unavailable, so views cannot be kept in this browser. Download the view as a file instead.'

export const CATALOG_UNREADABLE =
  'The list of views stored in this browser could not be read. It has not been changed; views can still be opened from a file.'

export function readHandoverCatalog(storage: Storage | null): {
  catalog: HandoverCatalog
  error: string | null
} {
  const empty: HandoverCatalog = { packages: [], unreadable: [] }
  if (!storage) return { catalog: empty, error: CATALOG_UNAVAILABLE }
  try {
    const raw = storage.getItem(HANDOVER_CATALOG_KEY)
    if (raw === null) return { catalog: empty, error: null }
    const parsed = JSON.parse(raw) as { version?: unknown; packages?: unknown }
    if (parsed?.version !== 1 || !Array.isArray(parsed.packages)) {
      return { catalog: empty, error: CATALOG_UNREADABLE }
    }
    const catalog: HandoverCatalog = { packages: [], unreadable: [] }
    for (const entry of parsed.packages) {
      const read = readHandoverPackage(entry)
      if (read.ok) catalog.packages.push(read.package)
      else catalog.unreadable.push(entry)
    }
    return { catalog, error: null }
  } catch {
    return { catalog: empty, error: CATALOG_UNREADABLE }
  }
}

export type CatalogWrite =
  { ok: true } | { ok: false; full: boolean; message: string }

export function writeHandoverCatalog(
  storage: Storage | null,
  catalog: HandoverCatalog,
): CatalogWrite {
  if (!storage) return { ok: false, full: false, message: CATALOG_UNAVAILABLE }
  try {
    storage.setItem(
      HANDOVER_CATALOG_KEY,
      JSON.stringify({
        version: 1,
        packages: [...catalog.packages, ...catalog.unreadable],
      }),
    )
    return { ok: true }
  } catch (error) {
    if (isQuotaError(error)) {
      return {
        ok: false,
        full: true,
        message:
          'Browser storage is full, so the view was not kept in this browser. Download it as a file instead, or remove older views from File > Save as… or the viewer page.',
      }
    }
    return {
      ok: false,
      full: false,
      message: `The list of views could not be stored: ${error instanceof Error ? error.message : String(error)}`,
    }
  }
}

/** The catalog's packages, newest first. */
export function catalogSummaries(catalog: HandoverCatalog): PackageSummary[] {
  return catalog.packages
    .map(summarizePackage)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}
