'use client'

import { useEffect, useId } from 'react'

// Global map to track dirty state per component instance
const dirtyStateMap = new Map<string, boolean>()
let listenersInitialized = false

function hasUnsavedChanges(): boolean {
  return Array.from(dirtyStateMap.values()).some(Boolean)
}

function handleBeforeUnload(e: BeforeUnloadEvent) {
  if (hasUnsavedChanges()) {
    e.preventDefault()
    e.returnValue = ''
  }
}

function handleClick(e: MouseEvent) {
  if (!hasUnsavedChanges()) return

  const target = e.target as HTMLElement
  const anchor = target.closest('a')

  if (!anchor) return

  // Only intercept internal navigation links
  const href = anchor.getAttribute('href')
  if (!href || href.startsWith('http') || href.startsWith('mailto:')) return

  // Normalize paths for comparison
  const currentPath = window.location.pathname
  const targetPath = href.startsWith('/')
    ? href.split('?')[0]
    : new URL(href, window.location.origin).pathname

  // Don't warn if staying on the same page
  if (targetPath === currentPath) return

  const confirmed = window.confirm(
    'You have unsaved changes. Are you sure you want to leave this page?'
  )

  if (!confirmed) {
    e.preventDefault()
    e.stopPropagation()
  }
}

function initializeListeners() {
  if (listenersInitialized) return
  listenersInitialized = true
  window.addEventListener('beforeunload', handleBeforeUnload)
  document.addEventListener('click', handleClick, true)
}

/**
 * Hook to warn users about unsaved changes when navigating away.
 * Handles both browser navigation (refresh, close tab) and
 * client-side navigation (clicking links).
 *
 * @param isDirty - Whether there are unsaved changes
 */
export function useUnsavedChangesWarning(isDirty: boolean) {
  const instanceId = useId()

  // Initialize global listeners once
  useEffect(() => {
    initializeListeners()
  }, [])

  // Update the global dirty state map
  useEffect(() => {
    dirtyStateMap.set(instanceId, isDirty)
    return () => {
      dirtyStateMap.delete(instanceId)
    }
  }, [instanceId, isDirty])
}
