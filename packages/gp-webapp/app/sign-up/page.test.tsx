import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

const { mockAuth, mockRedirect } = vi.hoisted(() => ({
  mockAuth: vi.fn(),
  mockRedirect: vi.fn((path: string) => {
    throw new Error(`redirect:${path}`)
  }),
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
})

describe('SignUpPage', () => {
  it('sends a signed-in visitor on, whatever the source', async () => {
    mockAuth.mockResolvedValue({ userId: 'user_1' })

    await expect(
      SignUpPage({
        params: Promise.resolve({}),
        searchParams: Promise.resolve({ signup_source: 'profile_claim' }),
      }),
    ).rejects.toThrow('redirect:/dashboard')
  })

  it('shows an ordinary visitor the original page', async () => {
    const { container } = await renderPage({})

    expect(screen.getByTestId('marketing-panel')).toBeInTheDocument()
    expect(screen.queryByTestId('claim-profile-panel')).toBeNull()
    expect(container.firstElementChild).not.toHaveClass(
      'xl:grid-cols-[41fr_31fr]',
    )
  })

  it('ignores any other or repeated source', async () => {
    for (const signup_source of [
      'profile_pledge',
      'PROFILE_CLAIM',
      '',
      ['profile_claim', 'profile_claim'],
    ]) {
      const { unmount } = await renderPage({ signup_source })
      expect(screen.getByTestId('marketing-panel')).toBeInTheDocument()
      expect(screen.queryByTestId('claim-profile-panel')).toBeNull()
      unmount()
    }
  })

  it('shows a claim visitor the claim panel with the Figma copy', async () => {
    const { container } = await renderPage({ signup_source: 'profile_claim' })

    expect(screen.getByTestId('claim-profile-panel')).toBeInTheDocument()
    expect(screen.queryByTestId('marketing-panel')).toBeNull()
    expect(container.firstElementChild).toHaveClass('xl:grid-cols-[41fr_31fr]')
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

  it('keeps the same sign-up form in both versions', async () => {
    await renderPage({})
    expect(screen.getAllByTestId('sign-up-form')).toHaveLength(1)

    await renderPage({ signup_source: 'profile_claim' })
    expect(screen.getAllByTestId('sign-up-form')).toHaveLength(2)
  })
})
