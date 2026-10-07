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
})
