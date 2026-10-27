/**
 * Text widths in a table's own fonts (decision 0028), so "Fit content"
 * sizes a column to its widest text rather than to a per-character guess.
 */
export type TextMeasure = {
  /** Width of a body cell's text, in px. */
  cell: (text: string) => number
  /** Width of a header label's text, in px (case and tracking applied). */
  header: (text: string) => number
}

type FontOf = {
  font: string
  letterSpacing: number
  upper: boolean
}

function fontOf(element: Element): FontOf {
  const style = getComputedStyle(element)
  const font =
    style.font ||
    `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`
  return {
    font,
    letterSpacing: Number.parseFloat(style.letterSpacing) || 0,
    upper: style.textTransform === 'uppercase',
  }
}

/**
 * Measures with a canvas using the fonts of a header cell and a body cell
 * found in `root`; null where canvas text measuring is unavailable (tests).
 */
export function createTextMeasure(
  root: Element,
  headerSelector: string,
  cellSelector: string,
): TextMeasure | null {
  if (typeof document === 'undefined') return null
  const context = document.createElement('canvas').getContext('2d')
  const headerElement = root.querySelector(headerSelector)
  const cellElement = root.querySelector(cellSelector) ?? root
  if (!context || !headerElement) return null
  const header = fontOf(headerElement)
  const cell = fontOf(cellElement)
  const measure = (text: string, font: FontOf) => {
    context.font = font.font
    const shown = font.upper ? text.toUpperCase() : text
    return context.measureText(shown).width + font.letterSpacing * shown.length
  }
  // A canvas that cannot measure (jsdom) reports zero for every text.
  if (measure('Mm', cell) === 0) return null
  return {
    cell: (text) => measure(text, cell),
    header: (text) => measure(text, header),
  }
}
