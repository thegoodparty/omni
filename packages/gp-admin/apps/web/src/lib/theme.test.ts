import { describe, it, expect } from 'vitest'
import { THEME, THEME_STORAGE_KEY, isValidTheme } from './theme'

describe('THEME', () => {
  it('should have LIGHT value', () => {
    expect(THEME.LIGHT).toBe('light')
  })

  it('should have DARK value', () => {
    expect(THEME.DARK).toBe('dark')
  })
})

describe('THEME_STORAGE_KEY', () => {
  it('should be "theme"', () => {
    expect(THEME_STORAGE_KEY).toBe('theme')
  })
})

describe('isValidTheme', () => {
  it('should return true for "light"', () => {
    expect(isValidTheme('light')).toBe(true)
  })

  it('should return true for "dark"', () => {
    expect(isValidTheme('dark')).toBe(true)
  })

  it('should return false for null', () => {
    expect(isValidTheme(null)).toBe(false)
  })

  it('should return false for invalid string', () => {
    expect(isValidTheme('invalid')).toBe(false)
  })

  it('should return false for empty string', () => {
    expect(isValidTheme('')).toBe(false)
  })
})
