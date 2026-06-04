'use client'

import { useThemeContext } from '@radix-ui/themes'
import { dark } from '@clerk/themes'
import { THEME } from '@/lib/theme'

export function useClerkTheme() {
  const { appearance } = useThemeContext()
  return appearance === THEME.DARK ? dark : undefined
}
