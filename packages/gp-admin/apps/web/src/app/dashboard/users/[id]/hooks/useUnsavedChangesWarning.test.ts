import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook } from '@testing-library/react'

describe('useUnsavedChangesWarning', () => {
  let addEventListenerSpy: ReturnType<typeof vi.spyOn>
  let confirmSpy: ReturnType<typeof vi.spyOn>
  const originalLocation = window.location

  beforeEach(() => {
    addEventListenerSpy = vi.spyOn(window, 'addEventListener')
    confirmSpy = vi.spyOn(window, 'confirm')
    // Mock window.location
    Object.defineProperty(window, 'location', {
      value: {
        pathname: '/dashboard/users/123/edit',
        origin: 'http://localhost',
      },
      configurable: true,
    })
    // Reset the module state between tests
    vi.resetModules()
  })

  afterEach(() => {
    vi.restoreAllMocks()
    Object.defineProperty(window, 'location', {
      value: originalLocation,
      configurable: true,
    })
  })

  it('registers beforeunload listener on mount', async () => {
    const { useUnsavedChangesWarning: hook } =
      await import('./useUnsavedChangesWarning')

    renderHook(() => hook(false))

    expect(addEventListenerSpy).toHaveBeenCalledWith(
      'beforeunload',
      expect.any(Function)
    )
  })

  it('registers click listener on mount', async () => {
    const { useUnsavedChangesWarning: hook } =
      await import('./useUnsavedChangesWarning')
    const docAddEventListenerSpy = vi.spyOn(document, 'addEventListener')

    renderHook(() => hook(false))

    expect(docAddEventListenerSpy).toHaveBeenCalledWith(
      'click',
      expect.any(Function),
      true
    )

    docAddEventListenerSpy.mockRestore()
  })

  it('does not trigger warning when isDirty is false', async () => {
    const { useUnsavedChangesWarning: hook } =
      await import('./useUnsavedChangesWarning')

    renderHook(() => hook(false))

    // Simulate beforeunload event
    const event = new Event('beforeunload') as BeforeUnloadEvent
    Object.defineProperty(event, 'preventDefault', { value: vi.fn() })
    Object.defineProperty(event, 'returnValue', {
      value: '',
      writable: true,
    })

    window.dispatchEvent(event)

    expect(event.preventDefault).not.toHaveBeenCalled()
  })

  it('triggers warning when isDirty is true on beforeunload', async () => {
    const { useUnsavedChangesWarning: hook } =
      await import('./useUnsavedChangesWarning')

    renderHook(() => hook(true))

    // Simulate beforeunload event
    const event = new Event('beforeunload') as BeforeUnloadEvent
    const preventDefaultMock = vi.fn()
    Object.defineProperty(event, 'preventDefault', {
      value: preventDefaultMock,
    })
    Object.defineProperty(event, 'returnValue', {
      value: '',
      writable: true,
    })

    window.dispatchEvent(event)

    expect(preventDefaultMock).toHaveBeenCalled()
  })

  it('updates dirty state when prop changes', async () => {
    const { useUnsavedChangesWarning: hook } =
      await import('./useUnsavedChangesWarning')

    const { rerender } = renderHook(({ isDirty }) => hook(isDirty), {
      initialProps: { isDirty: false },
    })

    // Initially not dirty - no warning
    let event = new Event('beforeunload') as BeforeUnloadEvent
    let preventDefaultMock = vi.fn()
    Object.defineProperty(event, 'preventDefault', {
      value: preventDefaultMock,
    })
    Object.defineProperty(event, 'returnValue', { value: '', writable: true })
    window.dispatchEvent(event)
    expect(preventDefaultMock).not.toHaveBeenCalled()

    // Change to dirty
    rerender({ isDirty: true })

    event = new Event('beforeunload') as BeforeUnloadEvent
    preventDefaultMock = vi.fn()
    Object.defineProperty(event, 'preventDefault', {
      value: preventDefaultMock,
    })
    Object.defineProperty(event, 'returnValue', { value: '', writable: true })
    window.dispatchEvent(event)
    expect(preventDefaultMock).toHaveBeenCalled()
  })

  it('cleans up dirty state on unmount', async () => {
    const { useUnsavedChangesWarning: hook } =
      await import('./useUnsavedChangesWarning')

    const { unmount } = renderHook(() => hook(true))

    // While mounted and dirty, should trigger warning
    let event = new Event('beforeunload') as BeforeUnloadEvent
    let preventDefaultMock = vi.fn()
    Object.defineProperty(event, 'preventDefault', {
      value: preventDefaultMock,
    })
    Object.defineProperty(event, 'returnValue', { value: '', writable: true })
    window.dispatchEvent(event)
    expect(preventDefaultMock).toHaveBeenCalled()

    // After unmount, should not trigger warning
    unmount()

    event = new Event('beforeunload') as BeforeUnloadEvent
    preventDefaultMock = vi.fn()
    Object.defineProperty(event, 'preventDefault', {
      value: preventDefaultMock,
    })
    Object.defineProperty(event, 'returnValue', { value: '', writable: true })
    window.dispatchEvent(event)
    expect(preventDefaultMock).not.toHaveBeenCalled()
  })

  describe('click handler', () => {
    it('shows confirm dialog when clicking internal link while dirty', async () => {
      const { useUnsavedChangesWarning: hook } =
        await import('./useUnsavedChangesWarning')
      confirmSpy.mockReturnValue(true)

      renderHook(() => hook(true))

      // Create anchor element and click event
      const anchor = document.createElement('a')
      anchor.setAttribute('href', '/dashboard/users/456')
      document.body.appendChild(anchor)

      const clickEvent = new MouseEvent('click', { bubbles: true })
      Object.defineProperty(clickEvent, 'target', { value: anchor })
      anchor.dispatchEvent(clickEvent)

      expect(confirmSpy).toHaveBeenCalledWith(
        'You have unsaved changes. Are you sure you want to leave this page?'
      )

      document.body.removeChild(anchor)
    })

    it('prevents navigation when user cancels confirm dialog', async () => {
      const { useUnsavedChangesWarning: hook } =
        await import('./useUnsavedChangesWarning')
      confirmSpy.mockReturnValue(false)

      renderHook(() => hook(true))

      const anchor = document.createElement('a')
      anchor.setAttribute('href', '/dashboard/users/456')
      document.body.appendChild(anchor)

      const clickEvent = new MouseEvent('click', {
        bubbles: true,
        cancelable: true,
      })
      const preventDefaultSpy = vi.spyOn(clickEvent, 'preventDefault')
      const stopPropagationSpy = vi.spyOn(clickEvent, 'stopPropagation')

      anchor.dispatchEvent(clickEvent)

      expect(preventDefaultSpy).toHaveBeenCalled()
      expect(stopPropagationSpy).toHaveBeenCalled()

      document.body.removeChild(anchor)
    })

    it('does not show confirm for non-anchor clicks', async () => {
      const { useUnsavedChangesWarning: hook } =
        await import('./useUnsavedChangesWarning')

      renderHook(() => hook(true))

      const div = document.createElement('div')
      document.body.appendChild(div)

      const clickEvent = new MouseEvent('click', { bubbles: true })
      div.dispatchEvent(clickEvent)

      expect(confirmSpy).not.toHaveBeenCalled()

      document.body.removeChild(div)
    })

    it('does not show confirm for external links', async () => {
      const { useUnsavedChangesWarning: hook } =
        await import('./useUnsavedChangesWarning')

      renderHook(() => hook(true))

      const anchor = document.createElement('a')
      anchor.setAttribute('href', 'https://example.com')
      document.body.appendChild(anchor)

      const clickEvent = new MouseEvent('click', { bubbles: true })
      anchor.dispatchEvent(clickEvent)

      expect(confirmSpy).not.toHaveBeenCalled()

      document.body.removeChild(anchor)
    })

    it('does not show confirm for mailto links', async () => {
      const { useUnsavedChangesWarning: hook } =
        await import('./useUnsavedChangesWarning')

      renderHook(() => hook(true))

      const anchor = document.createElement('a')
      anchor.setAttribute('href', 'mailto:test@example.com')
      document.body.appendChild(anchor)

      const clickEvent = new MouseEvent('click', { bubbles: true })
      anchor.dispatchEvent(clickEvent)

      expect(confirmSpy).not.toHaveBeenCalled()

      document.body.removeChild(anchor)
    })

    it('does not show confirm when navigating to same page', async () => {
      const { useUnsavedChangesWarning: hook } =
        await import('./useUnsavedChangesWarning')

      renderHook(() => hook(true))

      const anchor = document.createElement('a')
      anchor.setAttribute('href', '/dashboard/users/123/edit')
      document.body.appendChild(anchor)

      const clickEvent = new MouseEvent('click', { bubbles: true })
      anchor.dispatchEvent(clickEvent)

      expect(confirmSpy).not.toHaveBeenCalled()

      document.body.removeChild(anchor)
    })

    it('does not show confirm when not dirty', async () => {
      const { useUnsavedChangesWarning: hook } =
        await import('./useUnsavedChangesWarning')

      renderHook(() => hook(false))

      const anchor = document.createElement('a')
      anchor.setAttribute('href', '/dashboard/users/456')
      document.body.appendChild(anchor)

      const clickEvent = new MouseEvent('click', { bubbles: true })
      anchor.dispatchEvent(clickEvent)

      expect(confirmSpy).not.toHaveBeenCalled()

      document.body.removeChild(anchor)
    })

    it('handles relative href by converting to absolute path', async () => {
      const { useUnsavedChangesWarning: hook } =
        await import('./useUnsavedChangesWarning')
      confirmSpy.mockReturnValue(true)

      renderHook(() => hook(true))

      const anchor = document.createElement('a')
      anchor.setAttribute('href', 'other-page')
      document.body.appendChild(anchor)

      const clickEvent = new MouseEvent('click', { bubbles: true })
      anchor.dispatchEvent(clickEvent)

      expect(confirmSpy).toHaveBeenCalled()

      document.body.removeChild(anchor)
    })

    it('does not show confirm for anchor without href', async () => {
      const { useUnsavedChangesWarning: hook } =
        await import('./useUnsavedChangesWarning')

      renderHook(() => hook(true))

      const anchor = document.createElement('a')
      document.body.appendChild(anchor)

      const clickEvent = new MouseEvent('click', { bubbles: true })
      anchor.dispatchEvent(clickEvent)

      expect(confirmSpy).not.toHaveBeenCalled()

      document.body.removeChild(anchor)
    })

    it('does not re-register listeners on subsequent hook calls', async () => {
      const { useUnsavedChangesWarning: hook } =
        await import('./useUnsavedChangesWarning')

      // First render
      const { unmount } = renderHook(() => hook(false))

      const initialCallCount = addEventListenerSpy.mock.calls.filter(
        (call: [string, ...unknown[]]) => call[0] === 'beforeunload'
      ).length

      // Second render (should not add more listeners)
      unmount()
      renderHook(() => hook(false))

      const finalCallCount = addEventListenerSpy.mock.calls.filter(
        (call: [string, ...unknown[]]) => call[0] === 'beforeunload'
      ).length

      expect(finalCallCount).toBe(initialCallCount)
    })
  })
})
