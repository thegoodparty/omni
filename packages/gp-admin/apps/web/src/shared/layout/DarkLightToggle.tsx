'use client'

import { useEffect } from 'react'
import { MdDarkMode, MdLightMode } from 'react-icons/md'
import { IconButton, useThemeContext } from '@radix-ui/themes'

const THEME_STORAGE_KEY = 'theme'

export function DarkLightToggle() {
  const { appearance, onAppearanceChange } = useThemeContext()

  useEffect(() => {
    const savedTheme = localStorage.getItem(THEME_STORAGE_KEY) as 'light' | 'dark' | null
    const prefersDark = savedTheme
      ? savedTheme === 'dark'
      : window.matchMedia('(prefers-color-scheme: dark)').matches

    onAppearanceChange(prefersDark ? 'dark' : 'light')
  }, [onAppearanceChange])

  const toggleDarkMode = () => {
    const newAppearance = appearance === 'dark' ? 'light' : 'dark'
    onAppearanceChange(newAppearance)
    localStorage.setItem(THEME_STORAGE_KEY, newAppearance)
  }

  return (
    <IconButton
      variant="ghost"
      onClick={toggleDarkMode}
      aria-label="Toggle dark mode"
    >
      {appearance === 'dark' ? (
        <MdLightMode style={{ width: 20, height: 20 }} />
      ) : (
        <MdDarkMode style={{ width: 20, height: 20 }} />
      )}
    </IconButton>
  )
}
