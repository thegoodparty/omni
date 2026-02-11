'use client'

import { useEffect } from 'react'
import { MdDarkMode, MdLightMode } from 'react-icons/md'
import { IconButton, useThemeContext } from '@radix-ui/themes'
import { THEME, THEME_STORAGE_KEY } from '@/lib/theme'

export function DarkLightToggle() {
  const { appearance, onAppearanceChange } = useThemeContext()

  useEffect(() => {
    const savedTheme = localStorage.getItem(THEME_STORAGE_KEY)
    const prefersDark =
      savedTheme === THEME.DARK ||
      (savedTheme === null &&
        window.matchMedia('(prefers-color-scheme: dark)').matches)

    onAppearanceChange(prefersDark ? THEME.DARK : THEME.LIGHT)
  }, [onAppearanceChange])

  const toggleDarkMode = () => {
    const newAppearance = appearance === THEME.DARK ? THEME.LIGHT : THEME.DARK
    onAppearanceChange(newAppearance)
    localStorage.setItem(THEME_STORAGE_KEY, newAppearance)
  }

  return (
    <IconButton
      variant="ghost"
      onClick={toggleDarkMode}
      aria-label="Toggle dark mode"
    >
      {appearance === THEME.DARK ? (
        <MdLightMode className="w-5 h-5" />
      ) : (
        <MdDarkMode className="w-5 h-5" />
      )}
    </IconButton>
  )
}
