import { describe, expect, test } from 'vitest'
import { NO_DATA, formatCount, formatEnergy, formatNumber } from './format.ts'

describe('formatNumber', () => {
  test('groups thousands and rounds to whole numbers by default', () => {
    expect(formatNumber(1234.56)).toBe('1,235')
  })

  test('keeps the requested digits and appends the unit', () => {
    expect(formatNumber(1234.56, { maxDigits: 1, unit: 'kW' })).toBe(
      '1,234.6 kW',
    )
  })

  test('says there is no data for missing and non-finite values', () => {
    expect(formatNumber(null)).toBe(NO_DATA)
    expect(formatNumber(undefined)).toBe(NO_DATA)
    expect(formatNumber(Number.NaN)).toBe(NO_DATA)
  })
})

describe('formatEnergy', () => {
  test('scales kWh to MWh with one digit by default', () => {
    expect(formatEnergy(1_234_567)).toBe('1,234.6 MWh')
  })

  test('keeps kWh whole', () => {
    expect(formatEnergy(1_234.4, 'kWh')).toBe('1,234 kWh')
  })

  test('says there is no data for a missing value', () => {
    expect(formatEnergy(null)).toBe(NO_DATA)
  })
})

test('formatCount pluralises its noun', () => {
  expect(formatCount(1, 'job')).toBe('1 job')
  expect(formatCount(1200, 'building')).toBe('1,200 buildings')
})
