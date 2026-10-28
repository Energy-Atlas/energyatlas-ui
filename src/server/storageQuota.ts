// Browser storage is shared by saved projects, handover packages, and
// layouts (decision 0032, stage 5). When it fills up, a refusal names what
// takes the space so people know what to remove.

export const HANDOVER_CATALOG_KEY = 'eaui.handovers.v1'

/** A viewer's personal layouts for one handover package. */
export function viewerLayoutsKey(packageId: string): string {
  return `eaui.viewer.layouts.v1:${packageId}`
}

export function isQuotaError(error: unknown): boolean {
  return (
    error instanceof DOMException &&
    (error.name === 'QuotaExceededError' ||
      error.name === 'NS_ERROR_DOM_QUOTA_REACHED' ||
      error.code === 22)
  )
}

/** How many characters the handover catalog takes in storage, or 0. */
export function handoverCatalogSize(storage: Storage | null): number {
  try {
    return storage?.getItem(HANDOVER_CATALOG_KEY)?.length ?? 0
  } catch {
    return 0
  }
}

/** Why a write failed for a full storage, naming handover packages when they take space. */
export function storageFullMessage(
  what: string,
  storage: Storage | null,
): string {
  const packages = handoverCatalogSize(storage)
  return packages > 0
    ? `Browser storage is full, so ${what}. Handover packages in this browser take about ${Math.ceil(packages / 1024).toLocaleString('en-US')} KB: remove older ones from File > Hand over… or the viewer page, then try again.`
    : `Browser storage is full, so ${what}. Remove saved projects or site data in this browser, then try again.`
}
