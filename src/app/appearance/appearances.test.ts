import { describe, expect, it } from 'vitest'
import { readAppearancePreference } from '../theme.ts'
import {
  APPEARANCE_LIST,
  APPEARANCES,
  resolveAppearance,
} from './appearances.ts'
import { contrastRatio, relativeLuminance } from './contrast.ts'

const TEXT = 4.5
const GRAPHIC = 3

function storageWith(value: string | null): Storage {
  return { getItem: () => value } as unknown as Storage
}

describe.each(APPEARANCE_LIST)('$label appearance', (appearance) => {
  const { chrome, data } = appearance

  it('keeps text readable on every surface it is shown on', () => {
    for (const background of [
      chrome.bg,
      chrome.surface,
      chrome.surfaceRaised,
      chrome.selectedBg,
    ]) {
      expect(contrastRatio(chrome.text, background)).toBeGreaterThanOrEqual(
        TEXT,
      )
      expect(
        contrastRatio(chrome.textMuted, background),
      ).toBeGreaterThanOrEqual(TEXT)
    }
    expect(
      contrastRatio(chrome.accentText, chrome.surface),
    ).toBeGreaterThanOrEqual(TEXT)
    expect(
      contrastRatio(chrome.onAccent, chrome.accent),
    ).toBeGreaterThanOrEqual(TEXT)
    expect(contrastRatio(chrome.focus, chrome.surface)).toBeGreaterThanOrEqual(
      GRAPHIC,
    )
  })

  // Decision 0020: control edges, the accent outline of the active tab (drawn
  // on the surface behind a gap, never on the inverted fill), and the label
  // of inverted blocks (active tabs, primary actions).
  it('keeps controls, focus, and inverted blocks distinguishable', () => {
    for (const background of [
      chrome.bg,
      chrome.surface,
      chrome.surfaceRaised,
    ]) {
      expect(
        contrastRatio(chrome.borderInteractive, background),
      ).toBeGreaterThanOrEqual(GRAPHIC)
      expect(contrastRatio(chrome.focus, background)).toBeGreaterThanOrEqual(
        GRAPHIC,
      )
      expect(contrastRatio(chrome.accent, background)).toBeGreaterThanOrEqual(
        GRAPHIC,
      )
    }
    for (const background of [chrome.surfaceRaised, chrome.selectedBg]) {
      expect(
        contrastRatio(chrome.accentText, background),
      ).toBeGreaterThanOrEqual(TEXT)
    }
    expect(contrastRatio(chrome.surface, chrome.text)).toBeGreaterThanOrEqual(
      TEXT,
    )
    expect(
      contrastRatio(chrome.textMuted, chrome.toneNeutralBg),
    ).toBeGreaterThanOrEqual(TEXT)
  })

  it('keeps status tones readable on their tint and on plain surfaces', () => {
    const tones: [string, string][] = [
      [chrome.toneSuccessText, chrome.toneSuccessBg],
      [chrome.toneInfoText, chrome.toneInfoBg],
      [chrome.toneWarningText, chrome.toneWarningBg],
      [chrome.toneDangerText, chrome.toneDangerBg],
      [chrome.toneNeutralText, chrome.toneNeutralBg],
    ]
    for (const [text, tint] of tones) {
      for (const background of [tint, chrome.surface, chrome.surfaceRaised]) {
        expect(contrastRatio(text, background)).toBeGreaterThanOrEqual(TEXT)
      }
    }
  })

  it('keeps data marks distinguishable from the chart surface', () => {
    expect(data.ink.surface).toBe(chrome.surface)
    expect(new Set(data.categorical).size).toBe(data.categorical.length)
    for (const color of [
      ...data.categorical,
      data.deemphasis,
      data.selection,
    ]) {
      expect(contrastRatio(color, data.ink.surface)).toBeGreaterThanOrEqual(
        GRAPHIC,
      )
    }
    expect(
      contrastRatio(data.ink.muted, data.ink.surface),
    ).toBeGreaterThanOrEqual(TEXT)
    expect(
      contrastRatio(data.ink.primary, data.ink.surface),
    ).toBeGreaterThanOrEqual(TEXT)
  })

  it('declares the color scheme its surfaces actually use', () => {
    const lightText =
      relativeLuminance(chrome.text) > relativeLuminance(chrome.bg)
    expect(lightText).toBe(appearance.scheme === 'dark')
  })
})

describe('appearance preference', () => {
  it('resolves "system" to Light or Dark', () => {
    expect(resolveAppearance('system', false)).toBe(APPEARANCES.light)
    expect(resolveAppearance('system', true)).toBe(APPEARANCES.dark)
    expect(resolveAppearance('lieflat', true)).toBe(APPEARANCES.lieflat)
  })

  it('reads stored choices and falls back to "system"', () => {
    expect(readAppearancePreference(storageWith('darkEngineering'))).toBe(
      'darkEngineering',
    )
    expect(readAppearancePreference(storageWith('dark'))).toBe('dark')
    expect(readAppearancePreference(storageWith('neon'))).toBe('system')
    expect(readAppearancePreference(storageWith(null))).toBe('system')
    expect(readAppearancePreference(null)).toBe('system')
  })
})
