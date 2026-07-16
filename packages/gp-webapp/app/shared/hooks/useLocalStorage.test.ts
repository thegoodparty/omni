import { describe, it, expect, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useLocalStorage } from './useLocalStorage'

const KEY = 'test-key'

beforeEach(() => {
  localStorage.clear()
})

describe('useLocalStorage', () => {
  // Functional updaters must compose within one batch like useState's do:
  // two `(n) => n + 1` from 0 end at 2 in BOTH state and localStorage.
  // Original code (setState(value)): state 2, localStorage 1 — diverged.
  // Minimal fix (setState(valueToStore) from the render-time closure):
  // state 1, localStorage 1 — consistent but the updaters don't compose.
  it('composes functional updaters in one batch, in state and in localStorage', () => {
    const { result } = renderHook(() => useLocalStorage<number>(KEY, 0))

    act(() => {
      result.current[1]((n) => n + 1)
      result.current[1]((n) => n + 1)
    })

    expect(result.current[0]).toBe(2)
    expect(JSON.parse(localStorage.getItem(KEY) as string)).toBe(2)
  })

  it('round-trips a plain value', () => {
    const { result } = renderHook(() => useLocalStorage<string>(KEY, 'a'))

    act(() => {
      result.current[1]('b')
    })

    expect(result.current[0]).toBe('b')
    expect(JSON.parse(localStorage.getItem(KEY) as string)).toBe('b')
  })

  it('uses the initial value when storage is empty', () => {
    const { result } = renderHook(() => useLocalStorage<string>(KEY, 'default'))

    expect(result.current[0]).toBe('default')
  })
})
