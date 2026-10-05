import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderHook } from '@testing-library/react'
import { HOME_HEADLINES } from './nextThingCopy'

// The pick is cached per page load, so each test loads the module fresh.
const load = async () =>
  (await import('./useSessionHeadline')).useSessionHeadline

describe('useSessionHeadline', () => {
  beforeEach(() => {
    vi.resetModules()
    window.sessionStorage.clear()
  })

  it('picks a line from the set and keeps it for the session', async () => {
    const useSessionHeadline = await load()
    const { result } = renderHook(() => useSessionHeadline())

    expect(HOME_HEADLINES).toContain(result.current)
    expect(window.sessionStorage.getItem('home-headline')).toBe(result.current)
  })

  it('reuses the line already picked this session', async () => {
    window.sessionStorage.setItem('home-headline', 'Earn every vote')
    const useSessionHeadline = await load()
    const { result } = renderHook(() => useSessionHeadline())

    expect(result.current).toBe('Earn every vote')
  })

  it('ignores a stored line that is no longer in the set', async () => {
    window.sessionStorage.setItem(
      'home-headline',
      "Let's get you on the ballot",
    )
    vi.spyOn(Math, 'random').mockReturnValue(0)
    const useSessionHeadline = await load()
    const { result } = renderHook(() => useSessionHeadline())

    expect(result.current).toBe(HOME_HEADLINES[0])
  })
})
