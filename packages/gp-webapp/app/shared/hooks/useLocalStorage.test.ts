import { describe, it, expect, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useLocalStorage } from './useLocalStorage'

const KEY = 'test-key'

beforeEach(() => {
  localStorage.clear()
})

describe('useLocalStorage', () => {
  // Before the fix, `setState(value)` let React resolve the functional
  // updater against its own update queue (state ends at 2) while
  // localStorage was written from the stale outer `state` closure (ends at
  // 1) — the two diverge. This asserts they stay in sync.
  it('keeps state in sync with the persisted value across functional updates in one batch', () => {
    const { result } = renderHook(() => useLocalStorage<number>(KEY, 0))

    act(() => {
      result.current[1]((n) => n + 1)
      result.current[1]((n) => n + 1)
    })

    expect(result.current[0]).toBe(
      JSON.parse(localStorage.getItem(KEY) as string),
    )
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
