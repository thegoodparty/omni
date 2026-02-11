import { describe, it, expect } from 'vitest'
import { THEME, THEME_STORAGE_KEY, isValidTheme } from './theme'

describe('isValidTheme', () => {
  it('accepts light and dark themes', () => {
    expect(isValidTheme('light')).toBe(true)
    expect(isValidTheme('dark')).toBe(true)
  })

  it('rejects invalid theme values', () => {
    expect(isValidTheme(null)).toBe(false)
    expect(isValidTheme('')).toBe(false)
    expect(isValidTheme('auto')).toBe(false)
    expect(isValidTheme('system')).toBe(false)
  })
})

describe('theme constants', () => {
  it('exports expected theme values for Radix UI compatibility', () => {
    expect(THEME.LIGHT).toBe('light')
    expect(THEME.DARK).toBe('dark')
  })

  it('uses consistent localStorage key', () => {
    expect(THEME_STORAGE_KEY).toBe('theme')
  })
})
