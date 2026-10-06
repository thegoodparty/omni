import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderHook } from '@testing-library/react'
import { HOME_HEADLINES } from './nextThingCopy'

const mockAuth = vi.hoisted(() => ({
  value: { isLoaded: true, sessionId: 'sess_1' as string | null },
}))
vi.mock('@clerk/nextjs', () => ({ useAuth: () => mockAuth.value }))

// The pick is cached per page load, so each test loads the module fresh.
const load = async () =>
  (await import('./useSessionHeadline')).useSessionHeadline

const stored = (): { sessionId: string; headline: string } =>
  JSON.parse(window.localStorage.getItem('home-headline') ?? 'null')

describe('useSessionHeadline', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.restoreAllMocks()
    window.localStorage.clear()
    mockAuth.value = { isLoaded: true, sessionId: 'sess_1' }
  })

  it('picks a line for the login session and keeps it', async () => {
    const useSessionHeadline = await load()
    const { result } = renderHook(() => useSessionHeadline())

    expect(HOME_HEADLINES).toContain(result.current)
    expect(stored()).toEqual({ sessionId: 'sess_1', headline: result.current })
  })

  it('keeps the same line for the same login, across page loads', async () => {
    window.localStorage.setItem(
      'home-headline',
      JSON.stringify({ sessionId: 'sess_1', headline: 'Earn every vote' }),
    )
    const useSessionHeadline = await load()
    const { result } = renderHook(() => useSessionHeadline())

    expect(result.current).toBe('Earn every vote')
  })

  it('picks a new line, never the last one, after signing in again', async () => {
    window.localStorage.setItem(
      'home-headline',
      JSON.stringify({ sessionId: 'sess_old', headline: HOME_HEADLINES[0] }),
    )
    vi.spyOn(Math, 'random').mockReturnValue(0)
    const useSessionHeadline = await load()
    const { result } = renderHook(() => useSessionHeadline())

    expect(result.current).toBe(HOME_HEADLINES[1])
    expect(stored().sessionId).toBe('sess_1')
  })

  it('waits for the login to load before picking', async () => {
    mockAuth.value = { isLoaded: false, sessionId: null }
    const useSessionHeadline = await load()
    const { result } = renderHook(() => useSessionHeadline())

    expect(result.current).toBeNull()
    expect(window.localStorage.getItem('home-headline')).toBeNull()
  })
})
