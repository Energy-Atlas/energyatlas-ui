import { describe, expect, it } from 'vitest'
import { accountInitials, DEMO_ACCOUNT } from './demoAccount.ts'

describe('demo account', () => {
  it('takes initials from the first and last words', () => {
    expect(accountInitials(DEMO_ACCOUNT.name)).toBe('AC')
    expect(accountInitials('  mary   ann  de la cruz ')).toBe('MC')
    expect(accountInitials('Plato')).toBe('P')
    expect(accountInitials('')).toBe('?')
  })
})
