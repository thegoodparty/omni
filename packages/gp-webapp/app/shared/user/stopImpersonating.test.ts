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
    // The function navigates via window.location.href; stub it so jsdom does
    // not attempt a real navigation.
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { href: '' },
    })
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
