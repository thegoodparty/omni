'use client'

import { useThemeContext } from '@radix-ui/themes'
import { dark } from '@clerk/themes'
import { THEME } from '@/lib/theme'

/**
 * Hook for theme-related values
 *
 * Returns the current theme state and the appropriate Clerk theme object
 *
 * Usage:
 * ```tsx
 * const { isDarkMode, clerkTheme } = useTheme()
 *
 * <UserButton appearance={{ baseTheme: clerkTheme }} />
 * ```
 */
export function useTheme() {
  const { appearance, onAppearanceChange } = useThemeContext()
  const isDarkMode = appearance === THEME.DARK

  return {
    appearance,
    isDarkMode,
    onAppearanceChange,
    /** Clerk theme object - use for baseTheme prop */
    clerkTheme: isDarkMode ? dark : undefined,
  }
}
