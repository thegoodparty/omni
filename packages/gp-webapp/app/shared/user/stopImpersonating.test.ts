import { describe, it, expect, vi, beforeEach } from 'vitest'
import { stopImpersonatingAndReturnToAdmin } from './stopImpersonating'

const mockClearElectionResultDismissed = vi.fn()
vi.mock('app/dashboard/election-result/dismissal', () => ({
  clearElectionResultDismissed: () => mockClearElectionResultDismissed(),
}))

const mockDeleteCookie = vi.fn()
vi.mock('helpers/cookieHelper', () => ({
  deleteCookie: (name: string) => mockDeleteCookie(name),
}))

describe('stopImpersonatingAndReturnToAdmin', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    sessionStorage.clear()
    // The function navigates via window.location.href; stub it so jsdom does
    // not attempt a real navigation.
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { href: '' },
    })
  })

  it('redirects to the gp-admin origin, never a webapp-relative path', async () => {
    const signOut = vi.fn().mockResolvedValue(undefined)

    await stopImpersonatingAndReturnToAdmin(signOut)

    expect(window.location.href).toBe('http://localhost:3500/')
  })

  it('honors the admin return path stashed by the /impersonate entry flow', async () => {
    sessionStorage.setItem('gp_admin_return_to', '/dashboard/briefings')
    const signOut = vi.fn().mockResolvedValue(undefined)

    await stopImpersonatingAndReturnToAdmin(signOut)

    expect(window.location.href).toBe(
      'http://localhost:3500/dashboard/briefings',
    )
    expect(sessionStorage.getItem('gp_admin_return_to')).toBeNull()
  })

  it('clears the election-result dismissal after signing out', async () => {
    const signOut = vi.fn().mockResolvedValue(undefined)

    await stopImpersonatingAndReturnToAdmin(signOut)

    expect(signOut).toHaveBeenCalled()
    expect(mockClearElectionResultDismissed).toHaveBeenCalled()
  })

  it('drops the impersonated org selection so it cannot follow the admin back', async () => {
    // The cookie outlives the Clerk session by months, so leaving it set would
    // hand the staff member's own next visit the impersonated user's org.
    const signOut = vi.fn().mockResolvedValue(undefined)

    await stopImpersonatingAndReturnToAdmin(signOut)

    expect(mockDeleteCookie).toHaveBeenCalledWith('organization-slug')
  })
})
