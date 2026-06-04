/**
 * Theme constants for light/dark mode
 *
 * These align with Radix UI Theme's appearance values
 */

export const THEME = {
  LIGHT: 'light',
  DARK: 'dark',
} as const

export type ThemeAppearance = (typeof THEME)[keyof typeof THEME]

export const THEME_STORAGE_KEY = 'theme'

/**
 * Helper to check if a value is a valid theme
 */
export const isValidTheme = (value: string | null): value is ThemeAppearance =>
  value === THEME.LIGHT || value === THEME.DARK
