/**
 * CSV writing shared by every export (Results and every table's Download).
 * Text that a spreadsheet would read as a formula (starting with =, +, -, @,
 * tab, or carriage return) is prefixed with an apostrophe; numbers are
 * written as they are.
 */
export function csvField(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return ''
  const text =
    typeof value === 'string' && /^[=+\-@\t\r]/.test(value)
      ? `'${value}`
      : String(value)
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

/**
 * A header comment stays one unquoted line starting with "#", so tools that
 * skip comment lines still skip it. Control characters become spaces, double
 * quotes become single ones (a quote could open a field spanning lines), and
 * text after a comma that a spreadsheet would read as a formula gets an
 * apostrophe, as values do.
 */
export function csvCommentLine(text: string): string {
  return Array.from(text, (char) => {
    const code = char.charCodeAt(0)
    return code < 32 || code === 127 ? ' ' : char
  })
    .join('')
    .replace(/"/g, "'")
    .replace(/,(\s*)([=+\-@])/g, ",$1'$2")
}

/** Saves text as a file through a temporary link. */
export function downloadText(
  name: string,
  text: string,
  type = 'text/csv',
): void {
  const url = URL.createObjectURL(new Blob([text], { type }))
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = name
  anchor.hidden = true
  document.body.append(anchor)
  anchor.click()
  anchor.remove()
  // Revoke later so the browser has started the download.
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/** A file name from a label: lower case, words joined by hyphens. */
export function fileSlug(label: string, fallback = 'export'): string {
  const slug = label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
  return slug || fallback
}
