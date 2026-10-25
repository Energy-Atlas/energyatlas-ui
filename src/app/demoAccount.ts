// The account shown at the ribbon's right end. Demo only: there is no sign-in,
// and this fictional person stands in for a real account.
export const DEMO_ACCOUNT = { name: 'Avery Chen' }

/** Up to two letters, from the first and last words, as mail clients do. */
export function accountInitials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean)
  const first = words[0]?.[0] ?? ''
  const last = words.length > 1 ? (words.at(-1)?.[0] ?? '') : ''
  return (first + last).toUpperCase() || '?'
}
