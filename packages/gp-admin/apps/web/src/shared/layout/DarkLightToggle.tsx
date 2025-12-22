'use client'

import { useEffect, useState } from 'react'
import { MdDarkMode, MdLightMode } from 'react-icons/md'

const THEME_STORAGE_KEY = 'theme'

export function DarkLightToggle() {
  const [isDark, setIsDark] = useState(false)

  useEffect(() => {
    const savedTheme = localStorage.getItem(THEME_STORAGE_KEY)
    const prefersDark = savedTheme
      ? savedTheme === 'dark'
      : window.matchMedia('(prefers-color-scheme: dark)').matches

    setIsDark(prefersDark)
    document.documentElement.classList.toggle('dark', prefersDark)
  }, [])

  const toggleDarkMode = () => {
    const newIsDark = !isDark
    setIsDark(newIsDark)
    document.documentElement.classList.toggle('dark', newIsDark)
    localStorage.setItem(THEME_STORAGE_KEY, newIsDark ? 'dark' : 'light')
  }

  return (
    <button
      onClick={toggleDarkMode}
      className="p-2 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors"
      aria-label="Toggle dark mode"
    >
      {isDark ? (
        <MdLightMode className="w-5 h-5 text-yellow-500" />
      ) : (
        <MdDarkMode className="w-5 h-5 text-gray-600" />
      )}
    </button>
  )
}
