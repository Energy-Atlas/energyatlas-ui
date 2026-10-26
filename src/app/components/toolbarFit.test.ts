import { describe, expect, test } from 'vitest'
import { overflowingItems } from './toolbarFit.ts'

const base = { gap: 4, moreWidth: 30 }

describe('overflowingItems', () => {
  test('keeps everything when the row fits', () => {
    expect(
      overflowingItems({
        ...base,
        widths: [50, 50, 50],
        pinned: [false, false, false],
        available: 158,
      }),
    ).toEqual(new Set())
  })

  test('moves items from the end and keeps room for More', () => {
    // 50 + 4 + 50 + 4 + 30 = 138 fits; adding the third item does not.
    expect(
      overflowingItems({
        ...base,
        widths: [50, 50, 50],
        pinned: [false, false, false],
        available: 157,
      }),
    ).toEqual(new Set([2]))
  })

  test('never moves a pinned item', () => {
    expect(
      overflowingItems({
        ...base,
        widths: [50, 50, 50],
        pinned: [false, false, true],
        available: 120,
      }),
    ).toEqual(new Set([0, 1]))
  })

  test('moves every unpinned item when nothing fits', () => {
    expect(
      overflowingItems({
        ...base,
        widths: [50, 50],
        pinned: [false, false],
        available: 10,
      }),
    ).toEqual(new Set([0, 1]))
  })
})
