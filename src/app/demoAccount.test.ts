import { describe, expect, it } from 'vitest'
import {
  accountInitials,
  DEFAULT_ACCOUNT,
  readDemoAccount,
  storeDemoAccount,
} from './demoAccount.ts'

function memoryStorage(): Storage {
  const values = new Map<string, string>()
  return {
    get length() {
      return values.size
    },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => void values.delete(key),
    setItem: (key, value) => void values.set(key, value),
  }
}

describe('demo account', () => {
  it('takes initials from the first and last words', () => {
    expect(accountInitials('Avery Chen')).toBe('AC')
    expect(accountInitials('  mary   ann  de la cruz ')).toBe('MC')
    expect(accountInitials('Plato')).toBe('P')
    expect(accountInitials('')).toBe('?')
  })

  it('starts with the default account, including without storage', () => {
    expect(readDemoAccount(memoryStorage())).toBe(DEFAULT_ACCOUNT)
    expect(readDemoAccount(null)).toBe(DEFAULT_ACCOUNT)
  })

  it('round-trips a known account and ignores an unknown one', () => {
    const storage = memoryStorage()
    storeDemoAccount(storage, 'jordan')
    expect(readDemoAccount(storage).name).toBe('Jordan Okafor')
    storeDemoAccount(storage, 'nobody')
    expect(readDemoAccount(storage)).toBe(DEFAULT_ACCOUNT)
  })

  it('falls back to the default account when storage throws', () => {
    const blocked = {
      ...memoryStorage(),
      getItem: () => {
        throw new Error('blocked')
      },
    }
    expect(readDemoAccount(blocked)).toBe(DEFAULT_ACCOUNT)
  })
})
