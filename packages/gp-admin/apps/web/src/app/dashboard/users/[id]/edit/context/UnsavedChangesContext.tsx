'use client'

import {
  createContext,
  useContext,
  useState,
  useCallback,
  type ReactNode,
} from 'react'

interface UnsavedChangesContextValue {
  isDirty: boolean
  setIsDirty: (dirty: boolean) => void
  confirmNavigation: () => boolean
}

const UnsavedChangesContext = createContext<UnsavedChangesContextValue | null>(
  null
)

export function UnsavedChangesProvider({ children }: { children: ReactNode }) {
  const [isDirty, setIsDirty] = useState(false)

  const confirmNavigation = useCallback(() => {
    if (!isDirty) return true
    return window.confirm(
      'You have unsaved changes. Are you sure you want to leave this page?'
    )
  }, [isDirty])

  return (
    <UnsavedChangesContext.Provider
      value={{ isDirty, setIsDirty, confirmNavigation }}
    >
      {children}
    </UnsavedChangesContext.Provider>
  )
}

export function useUnsavedChangesContext(): UnsavedChangesContextValue | null {
  return useContext(UnsavedChangesContext)
}
