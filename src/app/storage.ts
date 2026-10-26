/** localStorage when usable; null in private modes, sandboxes, or when blocked. */
export function getBrowserStorage(): Storage | null {
  try {
    const storage = window.localStorage
    const probe = '__eaui_storage_probe__'
    storage.setItem(probe, probe)
    storage.removeItem(probe)
    return storage
  } catch {
    return null
  }
}

/** sessionStorage when usable, for choices that last one browser session. */
export function getSessionStorage(): Storage | null {
  try {
    const storage = window.sessionStorage
    const probe = '__eaui_storage_probe__'
    storage.setItem(probe, probe)
    storage.removeItem(probe)
    return storage
  } catch {
    return null
  }
}
