import {
  parseLayoutList,
  storedLayouts,
  type LayoutList,
} from './savedLayout.ts'

// Personal layouts stay in this browser and work in every project (decision
// 0032), as RC's pages keep their presets in localStorage. A stored value that
// cannot be read is never overwritten silently: writes stop until the person
// removes it, as with the project catalog.

export const PERSONAL_LAYOUTS_KEY = 'eaui.layouts.v1'

/**
 * A viewer's personal layouts for one handover package (decision 0032, stage
 * 5): apart from the modeller's, and from other packages', so a layout made
 * for one handover never appears over another. Removing a package removes them.
 */
export { viewerLayoutsKey } from '../../server/storageQuota.ts'

export type PersonalStatus =
  | { kind: 'ready' }
  /** Storage is blocked or unavailable; nothing can be kept here. */
  | { kind: 'unavailable'; message: string }
  /** The stored value cannot be read; it is kept until removed. */
  | { kind: 'unreadable'; message: string }

export const STORAGE_UNAVAILABLE =
  'Browser storage is unavailable, so personal layouts cannot be kept here. Project layouts still work and are saved with the project.'

export const STORAGE_UNREADABLE =
  'Personal layouts stored in this browser could not be read. They have not been changed; remove them to keep new personal layouts.'

export function readPersonalLayouts(
  storage: Storage | null,
  key: string = PERSONAL_LAYOUTS_KEY,
): {
  list: LayoutList
  status: PersonalStatus
} {
  const empty: LayoutList = { layouts: [], unreadable: [] }
  if (!storage) {
    return {
      list: empty,
      status: { kind: 'unavailable', message: STORAGE_UNAVAILABLE },
    }
  }
  try {
    const raw = storage.getItem(key)
    if (raw === null) return { list: empty, status: { kind: 'ready' } }
    const parsed = JSON.parse(raw) as { version?: unknown; layouts?: unknown }
    if (parsed?.version !== 1 || !Array.isArray(parsed.layouts)) {
      return {
        list: empty,
        status: { kind: 'unreadable', message: STORAGE_UNREADABLE },
      }
    }
    return {
      list: parseLayoutList(parsed.layouts, 'personal'),
      status: { kind: 'ready' },
    }
  } catch {
    return {
      list: empty,
      status: { kind: 'unreadable', message: STORAGE_UNREADABLE },
    }
  }
}

export function writePersonalLayouts(
  storage: Storage | null,
  list: LayoutList,
  key: string = PERSONAL_LAYOUTS_KEY,
): { ok: true } | { ok: false; message: string } {
  if (!storage) return { ok: false, message: STORAGE_UNAVAILABLE }
  try {
    storage.setItem(
      key,
      JSON.stringify({ version: 1, layouts: storedLayouts(list) }),
    )
    return { ok: true }
  } catch (error) {
    return {
      ok: false,
      message: `Personal layouts could not be stored: ${error instanceof Error ? error.message : String(error)}`,
    }
  }
}

/** Removes an unreadable stored value, the only way past it. */
export function removePersonalLayouts(
  storage: Storage | null,
  key: string = PERSONAL_LAYOUTS_KEY,
): { ok: true } | { ok: false; message: string } {
  if (!storage) return { ok: false, message: STORAGE_UNAVAILABLE }
  try {
    storage.removeItem(key)
    return { ok: true }
  } catch (error) {
    return {
      ok: false,
      message: `Personal layouts could not be removed: ${error instanceof Error ? error.message : String(error)}`,
    }
  }
}
