/**
 * Marks a menu item unavailable (decision 0028): its reason becomes the hover
 * tooltip and aria-disabled says it is unavailable, while the item stays
 * focusable so choosing it can report why. React Aria's MenuItem does not
 * pass `title` or `aria-disabled` through, so they are set on its element.
 */
export function unavailableRef(
  reason: string | null | undefined,
): (element: HTMLElement | null) => void {
  return (element) => {
    if (!element) return
    if (reason) {
      element.setAttribute('title', reason)
      element.setAttribute('aria-disabled', 'true')
    } else {
      element.removeAttribute('title')
      element.removeAttribute('aria-disabled')
    }
  }
}
