/**
 * Which toolbar items move into the More menu (decision 0027). Items leave
 * from the end, except pinned ones (primary actions), which always stay; once
 * anything overflows, room is kept for the More button itself.
 *
 * Returns the indexes of the items that overflow.
 */
export function overflowingItems({
  widths,
  pinned,
  gap,
  available,
  moreWidth,
}: {
  widths: number[]
  pinned: boolean[]
  gap: number
  available: number
  moreWidth: number
}): Set<number> {
  const rowWidth = (shown: number[], extra: number) =>
    shown.reduce((sum, index) => sum + (widths[index] ?? 0), 0) +
    gap * Math.max(0, shown.length - 1 + (extra > 0 ? 1 : 0)) +
    extra

  const all = widths.map((_, index) => index)
  if (rowWidth(all, 0) <= available) return new Set()

  const shown = [...all]
  const overflow = new Set<number>()
  for (let index = widths.length - 1; index >= 0; index -= 1) {
    if (rowWidth(shown, moreWidth) <= available) break
    if (pinned[index]) continue
    shown.splice(shown.indexOf(index), 1)
    overflow.add(index)
  }
  return overflow
}
