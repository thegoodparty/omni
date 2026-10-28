import { describe, expect, it } from 'vitest'
import {
  EMAIL_THEMES,
  type EmailThemeColors,
  type EmailThemeKey,
} from '@goodparty_org/contracts'

const WCAG_AA_TEXT = 4.5

const channel = (hex: string, offset: number): number => {
  const value = parseInt(hex.slice(offset, offset + 2), 16) / 255
  return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
}

const luminance = (hex: string): number =>
  0.2126 * channel(hex, 1) + 0.7152 * channel(hex, 3) + 0.0722 * channel(hex, 5)

const contrastRatio = (a: string, b: string): number => {
  const [lighter, darker] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return ((lighter ?? 0) + 0.05) / ((darker ?? 0) + 0.05)
}

type Pair = [text: keyof EmailThemeColors, background: keyof EmailThemeColors]

// Every text-on-background pairing the layouts draw. The footer sits on the
// card, so meta on bg is not drawn; it is checked below as a known gap.
const DRAWN_PAIRS: Pair[] = [
  ['headerText', 'header'],
  ['headline', 'card'],
  ['body', 'card'],
  ['meta', 'card'],
  ['ctaText', 'cta'],
  ['accentText', 'accent'],
]

// Contrast failures in the designer's palette that no layout draws today.
// The contracts colors are not ours to edit, so they are listed here and the
// test fails when one is fixed, as a prompt to delete its line.
const KNOWN_FAILURES: Partial<Record<EmailThemeKey, Pair[]>> = {
  // 4.40:1
  cream_and_forest: [['meta', 'bg']],
}

const THEME_KEYS = Object.keys(EMAIL_THEMES) as EmailThemeKey[]

describe('email theme contrast (WCAG AA, 4.5:1)', () => {
  it.each(THEME_KEYS)('%s passes on every drawn pairing', (key) => {
    const colors = EMAIL_THEMES[key].colors
    const failures = DRAWN_PAIRS.filter(
      ([text, background]) =>
        contrastRatio(colors[text], colors[background]) < WCAG_AA_TEXT,
    )
    expect(failures).toEqual([])
  })

  it.each(THEME_KEYS)('%s passes on meta text over the page bg', (key) => {
    const colors = EMAIL_THEMES[key].colors
    const known = KNOWN_FAILURES[key] ?? []
    const failing = contrastRatio(colors.meta, colors.bg) < WCAG_AA_TEXT
    expect(failing).toBe(known.some(([text]) => text === 'meta'))
  })
})
