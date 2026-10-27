import { useLayoutEffect, useState, type RefObject } from 'react'
import { createTextMeasure, type TextMeasure } from '../tables/measureText.ts'

/**
 * Measures text in a table's own header and cell fonts once it has rendered
 * and its web fonts have loaded; null until then, when column widths fall
 * back to an estimate. It measures once, so a table re-applies its widths at
 * most once.
 */
export function useTextMeasure(
  rootRef: RefObject<HTMLElement | null>,
  headerSelector: string,
  cellSelector: string,
): TextMeasure | null {
  const [measure, setMeasure] = useState<TextMeasure | null>(null)
  useLayoutEffect(() => {
    let live = true
    const update = () => {
      const root = rootRef.current
      if (!live || !root) return
      setMeasure(createTextMeasure(root, headerSelector, cellSelector))
    }
    if (document.fonts) void document.fonts.ready.then(update)
    else update()
    return () => {
      live = false
    }
  }, [rootRef, headerSelector, cellSelector])
  return measure
}
