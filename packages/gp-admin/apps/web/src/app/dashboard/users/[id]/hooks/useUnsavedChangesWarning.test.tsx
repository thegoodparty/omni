import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import { type ReactNode } from 'react'
import { useUnsavedChangesWarning } from './useUnsavedChangesWarning'
import { UnsavedChangesProvider } from '../edit/context/UnsavedChangesContext'

function wrapper({ children }: { children: ReactNode }) {
  return <UnsavedChangesProvider>{children}</UnsavedChangesProvider>
}

describe('useUnsavedChangesWarning', () => {
  let addEventListenerSpy: ReturnType<typeof vi.spyOn>
  let removeEventListenerSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    addEventListenerSpy = vi.spyOn(window, 'addEventListener')
    removeEventListenerSpy = vi.spyOn(window, 'removeEventListener')
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('registers beforeunload listener on mount', () => {
    renderHook(() => useUnsavedChangesWarning(false), { wrapper })

    expect(addEventListenerSpy).toHaveBeenCalledWith(
      'beforeunload',
      expect.any(Function)
    )
  })

  it('removes beforeunload listener on unmount', () => {
    const { unmount } = renderHook(() => useUnsavedChangesWarning(false), {
      wrapper,
    })

    unmount()

    expect(removeEventListenerSpy).toHaveBeenCalledWith(
      'beforeunload',
      expect.any(Function)
    )
  })

  it('does not trigger warning when isDirty is false', () => {
    renderHook(() => useUnsavedChangesWarning(false), { wrapper })

    const event = new Event('beforeunload') as BeforeUnloadEvent
    Object.defineProperty(event, 'preventDefault', { value: vi.fn() })
    Object.defineProperty(event, 'returnValue', {
      value: '',
      writable: true,
    })

    window.dispatchEvent(event)

    expect(event.preventDefault).not.toHaveBeenCalled()
  })

  it('triggers warning when isDirty is true on beforeunload', () => {
    renderHook(() => useUnsavedChangesWarning(true), { wrapper })

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

  it('updates dirty state when prop changes', () => {
    const { rerender } = renderHook(
      ({ isDirty }) => useUnsavedChangesWarning(isDirty),
      {
        wrapper,
        initialProps: { isDirty: false },
      }
    )

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

  it('cleans up dirty state on unmount', () => {
    const { unmount } = renderHook(() => useUnsavedChangesWarning(true), {
      wrapper,
    })

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

  it('throws error when used outside UnsavedChangesProvider', () => {
    expect(() => {
      renderHook(() => useUnsavedChangesWarning(false))
    }).toThrow('useUnsavedChangesWarning must be used within UnsavedChangesProvider')
  })
})
