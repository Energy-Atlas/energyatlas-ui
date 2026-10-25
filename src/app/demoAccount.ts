// The account shown at the ribbon's right end. Demo only: there is no sign-in,
// and these fictional people stand in for real accounts. The chosen one is
// kept in this browser like the appearance preference.
const ACCOUNT_KEY = 'eaui.account'

export type DemoAccount = {
  id: string
  name: string
  role: string
}

export const DEMO_ACCOUNTS: DemoAccount[] = [
  { id: 'avery', name: 'Avery Chen', role: 'Energy modeller' },
  { id: 'jordan', name: 'Jordan Okafor', role: 'Project lead' },
  { id: 'sam', name: 'Sam Rivera', role: 'Reviewer' },
]

export const DEFAULT_ACCOUNT = DEMO_ACCOUNTS[0] as DemoAccount

/** Up to two letters, from the first and last words, as mail clients do. */
export function accountInitials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean)
  const first = words[0]?.[0] ?? ''
  const last = words.length > 1 ? (words.at(-1)?.[0] ?? '') : ''
  return (first + last).toUpperCase() || '?'
}

export function findDemoAccount(id: string): DemoAccount | undefined {
  return DEMO_ACCOUNTS.find((account) => account.id === id)
}

export function readDemoAccount(storage: Storage | null): DemoAccount {
  try {
    const id = storage?.getItem(ACCOUNT_KEY)
    return (id ? findDemoAccount(id) : undefined) ?? DEFAULT_ACCOUNT
  } catch {
    return DEFAULT_ACCOUNT
  }
}

export function storeDemoAccount(storage: Storage | null, id: string): void {
  try {
    storage?.setItem(ACCOUNT_KEY, id)
  } catch {
    // Storage is blocked; the choice applies for this session only.
  }
}
