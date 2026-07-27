import { describe, it, expect, vi, beforeEach } from 'vitest'
import publicProfileAccess from './publicProfileAccess'

const { mockAuth, mockServerFetch, mockRedirect } = vi.hoisted(() => ({
  mockAuth: vi.fn(),
  mockServerFetch: vi.fn(),
  mockRedirect: vi.fn(),
}))

vi.mock('@clerk/nextjs/server', () => ({
  auth: () => mockAuth(),
}))

vi.mock('gpApi/serverFetch', () => ({
  serverFetch: (...args: unknown[]) => mockServerFetch(...args),
}))

vi.mock('next/navigation', () => ({
  redirect: (url: string) => mockRedirect(url) as never,
}))

// Pure helper; stub so the module import resolves cleanly under vitest.
vi.mock('next/dist/client/components/redirect-error', () => ({
  isRedirectError: () => false,
}))

beforeEach(() => {
  vi.clearAllMocks()
  mockAuth.mockResolvedValue({ userId: 'user_123' })
})

describe('publicProfileAccess', () => {
  it('redirects unauthenticated callers to sign-up', async () => {
    mockAuth.mockResolvedValue({ userId: null })

    await publicProfileAccess()

    expect(mockRedirect).toHaveBeenCalledWith('/sign-up')
    expect(mockServerFetch).not.toHaveBeenCalled()
  })

  it('resolves to "serve" for a current elected official', async () => {
    // First lookup is elected-office.current.
    mockServerFetch.mockResolvedValueOnce({ ok: true, data: { id: 'eo-1' } })

    const product = await publicProfileAccess()

    expect(product).toBe('serve')
    expect(mockRedirect).not.toHaveBeenCalled()
    // Short-circuits before the campaign lookup.
    expect(mockServerFetch).toHaveBeenCalledTimes(1)
  })

  it('resolves to "win" for a candidate with a campaign but no office', async () => {
    mockServerFetch
      .mockResolvedValueOnce({ ok: false, data: null }) // elected-office.current
      .mockResolvedValueOnce({ data: { status: 'active' } }) // campaign.status

    const product = await publicProfileAccess()

    expect(product).toBe('win')
    expect(mockRedirect).not.toHaveBeenCalled()
  })

  it('bounces to /dashboard when the user is neither an official nor a candidate', async () => {
    mockServerFetch
      .mockResolvedValueOnce({ ok: false, data: null }) // no elected office
      .mockResolvedValueOnce({ data: {} }) // no campaign status

    await publicProfileAccess()

    expect(mockRedirect).toHaveBeenCalledWith('/dashboard')
  })
})
