import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, waitFor } from '@testing-library/react'
import ImpersonatePageContent from './ImpersonatePageContent'

const mockClearElectionResultDismissed = vi.fn()
vi.mock('app/dashboard/election-result/dismissal', () => ({
  clearElectionResultDismissed: () => mockClearElectionResultDismissed(),
}))

const mockSignOut = vi.fn()
const mockSetActive = vi.fn()
const mockSignInCreate = vi.fn()
vi.mock('@clerk/nextjs', () => ({
  useClerk: () => ({
    client: { signIn: { create: mockSignInCreate } },
    setActive: mockSetActive,
    signOut: mockSignOut,
    loaded: true,
  }),
}))

vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams({ __clerk_ticket: 'ticket-abc' }),
}))

describe('ImpersonatePageContent', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockSignOut.mockResolvedValue(undefined)
    mockSetActive.mockResolvedValue(undefined)
    mockSignInCreate.mockResolvedValue({
      status: 'complete',
      createdSessionId: 'sess-1',
    })
    // The component navigates via window.location.href; stub it so jsdom does
    // not attempt a real navigation.
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { href: '' },
    })
  })

  it('clears the election-result dismissal after activating the impersonated session', async () => {
    render(<ImpersonatePageContent />)

    await waitFor(() =>
      expect(mockSetActive).toHaveBeenCalledWith({ session: 'sess-1' }),
    )
    // Starting a new impersonation session in the same tab must clear any
    // prior candidate's election-result dismissal.
    expect(mockClearElectionResultDismissed).toHaveBeenCalled()
  })
})
