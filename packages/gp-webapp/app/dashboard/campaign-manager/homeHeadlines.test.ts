import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import {
  HOME_HEADLINES,
  pickHomeHeadline,
  useHomeHeadline,
} from './homeHeadlines'

describe('useHomeHeadline', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    window.localStorage.clear()
    window.sessionStorage.clear()
  })

  it('picks a line from the set on each visit', async () => {
    const { result } = renderHook(() => useHomeHeadline())

    await waitFor(() => expect(HOME_HEADLINES).toContain(result.current))
    expect(window.localStorage.getItem('home-headline-last')).toBe(
      result.current,
    )
  })

  it('never shows the same line twice in a row', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0)
    window.localStorage.setItem('home-headline-last', HOME_HEADLINES[0])

    expect(pickHomeHeadline()).toBe(HOME_HEADLINES[1])
    expect(pickHomeHeadline()).toBe(HOME_HEADLINES[0])
  })

  it('shows every line once in a session before any repeats', () => {
    const shown = HOME_HEADLINES.map(() => pickHomeHeadline())

    expect(new Set(shown).size).toBe(HOME_HEADLINES.length)
  })

  it('starts the session over once all have been shown, without repeating the last', () => {
    const shown = HOME_HEADLINES.map(() => pickHomeHeadline())
    const last = shown[shown.length - 1]

    const next = pickHomeHeadline()
    expect(HOME_HEADLINES).toContain(next)
    expect(next).not.toBe(last)
    expect(
      JSON.parse(window.sessionStorage.getItem('home-headlines-seen')!),
    ).toEqual([next])
  })
})
