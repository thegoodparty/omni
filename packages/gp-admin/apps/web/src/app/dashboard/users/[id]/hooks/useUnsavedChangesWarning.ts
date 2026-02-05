'use client'

import { useEffect } from 'react'
import { useUnsavedChangesContext } from '../edit/context/UnsavedChangesContext'

/**
 * Hook to warn users about unsaved changes when navigating away.
 * - Updates the shared context so TabNavigation can intercept link clicks
 * - Handles browser navigation (refresh, close tab) via beforeunload
 *
 * @param isDirty - Whether there are unsaved changes
 */
export function useUnsavedChangesWarning(isDirty: boolean) {
  const context = useUnsavedChangesContext()

  if (!context) {
    throw new Error(
      'useUnsavedChangesWarning must be used within UnsavedChangesProvider'
    )
  }

  const { setIsDirty } = context

  // Sync dirty state to context for TabNavigation to read
  useEffect(() => {
    setIsDirty(isDirty)
    return () => setIsDirty(false)
  }, [isDirty, setIsDirty])

  // Handle browser navigation (refresh, close tab, external links)
  useEffect(() => {
    function handleBeforeUnload(e: BeforeUnloadEvent) {
      if (isDirty) {
        e.preventDefault()
        e.returnValue = ''
      }
    }

    window.addEventListener('beforeunload', handleBeforeUnload)
    return () => window.removeEventListener('beforeunload', handleBeforeUnload)
  }, [isDirty])
}
