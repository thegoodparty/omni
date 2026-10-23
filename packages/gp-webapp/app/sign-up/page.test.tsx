import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

const { mockAuth, mockRedirect, mockVariationOn } = vi.hoisted(() => ({
  mockAuth: vi.fn(),
  mockRedirect: vi.fn((path: string) => {
    throw new Error(`redirect:${path}`)
  }),
  mockVariationOn: vi.fn(),
}))

vi.mock('@clerk/nextjs/server', () => ({ auth: () => mockAuth() }))
vi.mock('next/navigation', () => ({
  redirect: (path: string) => mockRedirect(path),
}))
vi.mock('app/dashboard/shared/candidateAccess', () => ({
  getPostAuthRedirectPath: async () => '/dashboard',
}))
vi.mock('./SignUpForm', () => ({
  default: () => <form data-testid="sign-up-form" />,
}))
vi.mock('./MarketingPanel', () => ({
  default: () => <div data-testid="marketing-panel" />,
}))
vi.mock('./profileClaimVariation', () => ({
  PROFILE_CLAIM_SIGNUP_SOURCE: 'profile_claim',
  isProfileClaimVariationOn: () => mockVariationOn(),
}))

import SignUpPage from './page'

const renderPage = async (
  searchParams: Record<string, string | string[] | undefined>,
) =>
  render(
    await SignUpPage({
      params: Promise.resolve({}),
      searchParams: Promise.resolve(searchParams),
    }),
  )

beforeEach(() => {
  mockAuth.mockResolvedValue({ userId: null })
  mockRedirect.mockClear()
  mockVariationOn.mockReset()
})

describe('SignUpPage', () => {
  it('sends a signed-in visitor on without evaluating the flag', async () => {
    mockAuth.mockResolvedValue({ userId: 'user_1' })
    mockVariationOn.mockResolvedValue(true)

    await expect(
      SignUpPage({
        params: Promise.resolve({}),
        searchParams: Promise.resolve({ signup_source: 'profile_claim' }),
      }),
    ).rejects.toThrow('redirect:/dashboard')
    expect(mockVariationOn).not.toHaveBeenCalled()
  })

  it('shows an ordinary visitor the original page without calling Amplitude', async () => {
    await renderPage({})

    expect(screen.getByTestId('marketing-panel')).toBeInTheDocument()
    expect(screen.queryByTestId('claim-profile-panel')).toBeNull()
    expect(mockVariationOn).not.toHaveBeenCalled()
  })

  it('ignores any other or repeated source without calling Amplitude', async () => {
    for (const signup_source of [
      'profile_pledge',
      'PROFILE_CLAIM',
      '',
      ['profile_claim', 'profile_claim'],
    ]) {
      const { unmount } = await renderPage({ signup_source })
      expect(screen.getByTestId('marketing-panel')).toBeInTheDocument()
      unmount()
    }
    expect(mockVariationOn).not.toHaveBeenCalled()
  })

  it('shows a claim visitor the claim panel when the flag is on', async () => {
    mockVariationOn.mockResolvedValue(true)
    await renderPage({ signup_source: 'profile_claim' })

    expect(screen.getByTestId('claim-profile-panel')).toBeInTheDocument()
    expect(screen.queryByTestId('marketing-panel')).toBeNull()
    expect(screen.getByText('Claim your profile')).toBeInTheDocument()
    expect(
      screen.getByRole('heading', {
        level: 2,
        name: 'Claim your voter guide profile',
      }),
    ).toBeInTheDocument()
    expect(
      screen.getByText(
        'Create an account to claim your GoodParty.org profile and keep your community informed.',
      ),
    ).toBeInTheDocument()
    expect(
      screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent),
    ).toEqual([
      'Verify your identity',
      'Update your profile',
      'Reach more voters',
    ])
  })

  it('shows a claim visitor the original page when the flag is off, unset, failed or timed out', async () => {
    // isProfileClaimVariationOn folds every one of those into false; its own
    // test covers each case.
    mockVariationOn.mockResolvedValue(false)
    await renderPage({ signup_source: 'profile_claim' })

    expect(screen.getByTestId('marketing-panel')).toBeInTheDocument()
    expect(screen.queryByTestId('claim-profile-panel')).toBeNull()
    expect(mockVariationOn).toHaveBeenCalledTimes(1)
  })

  it('keeps the same sign-up form in both versions', async () => {
    await renderPage({})
    expect(screen.getAllByTestId('sign-up-form')).toHaveLength(1)

    mockVariationOn.mockResolvedValue(true)
    await renderPage({ signup_source: 'profile_claim' })
    expect(screen.getAllByTestId('sign-up-form')).toHaveLength(2)
  })
})
