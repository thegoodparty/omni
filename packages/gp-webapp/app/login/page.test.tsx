import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render } from '@testing-library/react'
import LoginPage from './page'

const {
  mockAuth,
  mockRedirect,
  mockGetPostAuthRedirectPath,
  mockSignIn,
  RedirectSignal,
} = vi.hoisted(() => ({
  mockAuth: vi.fn(),
  mockRedirect: vi.fn(),
  mockGetPostAuthRedirectPath: vi.fn(),
  mockSignIn: vi.fn(),
  RedirectSignal: class RedirectSignal extends Error {},
}))

vi.mock('@clerk/nextjs/server', () => ({
  auth: () => mockAuth(),
}))

// `redirect()` throws in real Next.js to halt rendering; `login/page.tsx` relies
// on that (no explicit `return` after calling it), so the mock must too.
vi.mock('next/navigation', () => ({
  redirect: (url: string) => {
    mockRedirect(url)
    throw new RedirectSignal(url)
  },
}))

vi.mock('app/dashboard/shared/candidateAccess', () => ({
  getPostAuthRedirectPath: () => mockGetPostAuthRedirectPath(),
}))

vi.mock('@clerk/nextjs', () => ({
  SignIn: (props: Record<string, unknown>) => {
    mockSignIn(props)
    return null
  },
}))

const renderLoginPage = async (
  searchParams: Record<string, string | undefined> = {},
) => {
  try {
    const element = await LoginPage({
      params: Promise.resolve({}),
      searchParams: Promise.resolve(searchParams),
    } as never)
    render(element)
  } catch (e) {
    if (!(e instanceof RedirectSignal)) throw e
  }
}

describe('LoginPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAuth.mockResolvedValue({ userId: null })
  })

  it('signed out, no deep link: SignIn still carries source=signup for embedded sign-up', async () => {
    await renderLoginPage()

    expect(mockRedirect).not.toHaveBeenCalled()
    expect(mockSignIn).toHaveBeenCalledWith(
      expect.objectContaining({
        fallbackRedirectUrl: '/post-auth-redirect',
        signUpForceRedirectUrl: '/post-auth-redirect?source=signup',
      }),
    )
  })

  it('signed out with a deep link: forwards next and still carries source=signup on the sign-up variant', async () => {
    await renderLoginPage({ redirect_url: '/dashboard/briefings' })

    expect(mockSignIn).toHaveBeenCalledWith(
      expect.objectContaining({
        forceRedirectUrl: '/post-auth-redirect?next=%2Fdashboard%2Fbriefings',
        signUpForceRedirectUrl:
          '/post-auth-redirect?next=%2Fdashboard%2Fbriefings&source=signup',
      }),
    )
  })

  it('signed out with an unsafe deep link: falls back to the plain redirect props', async () => {
    await renderLoginPage({ redirect_url: 'https://evil.com' })

    expect(mockSignIn).toHaveBeenCalledWith(
      expect.objectContaining({
        fallbackRedirectUrl: '/post-auth-redirect',
        signUpForceRedirectUrl: '/post-auth-redirect?source=signup',
      }),
    )
  })

  it('already signed in, no deep link: redirects via the role-aware resolver', async () => {
    mockAuth.mockResolvedValue({ userId: 'user_123' })
    mockGetPostAuthRedirectPath.mockResolvedValue('/dashboard')

    await renderLoginPage()

    expect(mockRedirect).toHaveBeenCalledWith('/dashboard')
    expect(mockSignIn).not.toHaveBeenCalled()
  })

  it('already signed in with a deep link: redirects through post-auth-redirect with next', async () => {
    mockAuth.mockResolvedValue({ userId: 'user_123' })

    await renderLoginPage({ redirect_url: '/dashboard/briefings' })

    expect(mockRedirect).toHaveBeenCalledWith(
      '/post-auth-redirect?next=%2Fdashboard%2Fbriefings',
    )
  })
})
