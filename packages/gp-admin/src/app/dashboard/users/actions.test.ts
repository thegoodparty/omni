import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createImpersonationToken } from './actions'
import { PERMISSIONS } from '@/lib/permissions'

// --- next/cache ---
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

// --- Clerk server auth ---
const mockHas = vi.fn()
const mockAuth = vi.fn()
vi.mock('@clerk/nextjs/server', () => ({
  auth: () => mockAuth(),
}))

// --- Clerk backend (M2M token) ---
const mockCreateToken = vi.fn()
vi.mock('@clerk/backend', () => ({
  createClerkClient: vi.fn(() => ({
    m2m: { createToken: mockCreateToken },
  })),
}))

// --- GP environment helpers ---
vi.mock('@/shared/util/gpEnvironment', () => ({
  resolveEnvironment: vi.fn(() => 'dev'),
  getEnvironmentConfig: vi.fn(() => ({
    gpApiRootUrl: 'http://localhost:3000/v1',
    m2mSecret: 'ak_test_secret',
  })),
}))

// --- GP API client (not used by createImpersonationToken but imported by module) ---
vi.mock('@/shared/util/gpClient.util', () => ({
  gpAction: vi.fn(),
}))

// --- fetch ---
const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

function makeAuthResult(overrides: Record<string, unknown> = {}) {
  return {
    userId: 'user_admin_123',
    orgId: 'org_dev',
    has: mockHas,
    ...overrides,
  }
}

describe('createImpersonationToken', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockHas.mockReturnValue(true)
    mockAuth.mockReturnValue(makeAuthResult())
    mockCreateToken.mockResolvedValue({ token: 'mt_impersonate_token' })
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ token: 'clerk_ticket_xyz' }),
    })
  })

  describe('auth guards', () => {
    it('throws Not authenticated when no userId', async () => {
      mockAuth.mockReturnValue(makeAuthResult({ userId: null }))

      await expect(createImpersonationToken(1)).rejects.toThrow(
        'Not authenticated'
      )
    })

    it('throws No active organization when no orgId', async () => {
      mockAuth.mockReturnValue(makeAuthResult({ orgId: null }))

      await expect(createImpersonationToken(1)).rejects.toThrow(
        'No active organization'
      )
    })

    it('throws Missing impersonate permission when has() returns false', async () => {
      mockHas.mockReturnValue(false)

      await expect(createImpersonationToken(1)).rejects.toThrow(
        'Missing impersonate permission'
      )
    })

    it('checks the IMPERSONATE_USERS permission', async () => {
      await createImpersonationToken(1)

      expect(mockHas).toHaveBeenCalledWith({
        permission: PERMISSIONS.IMPERSONATE_USERS,
      })
    })
  })

  describe('M2M token creation', () => {
    it('creates M2M token using the environment machine secret', async () => {
      await createImpersonationToken(1)

      expect(mockCreateToken).toHaveBeenCalledWith({
        machineSecretKey: 'ak_test_secret',
      })
    })
  })

  describe('gp-api call', () => {
    it('calls the correct impersonation endpoint for the target user', async () => {
      await createImpersonationToken(99)

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:3000/v1/admin/users/impersonate/99',
        expect.any(Object)
      )
    })

    it('uses POST method', async () => {
      await createImpersonationToken(1)

      const [, options] = mockFetch.mock.calls[0]
      expect(options.method).toBe('POST')
    })

    it('sends Authorization: Bearer with the M2M token', async () => {
      await createImpersonationToken(1)

      const [, options] = mockFetch.mock.calls[0]
      expect(options.headers['Authorization']).toBe(
        'Bearer mt_impersonate_token'
      )
    })

    it('sends actorClerkId in the request body', async () => {
      await createImpersonationToken(1)

      const [, options] = mockFetch.mock.calls[0]
      const body = JSON.parse(options.body)
      expect(body.actorClerkId).toBe('user_admin_123')
    })

    it('sets Content-Type to application/json', async () => {
      await createImpersonationToken(1)

      const [, options] = mockFetch.mock.calls[0]
      expect(options.headers['Content-Type']).toBe('application/json')
    })
  })

  describe('response handling', () => {
    it('returns the token from a successful response', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ token: 'clerk_ticket_xyz' }),
      })

      const result = await createImpersonationToken(1)

      expect(result).toEqual({ token: 'clerk_ticket_xyz' })
    })

    it('throws with status code when gp-api returns a non-ok response', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 403,
        text: async () => 'Forbidden',
      })

      await expect(createImpersonationToken(1)).rejects.toThrow(
        'Failed to create impersonation token: 403 Forbidden'
      )
    })

    it('throws with status code when gp-api returns 500', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 500,
        text: async () => 'Internal Server Error',
      })

      await expect(createImpersonationToken(1)).rejects.toThrow(
        'Failed to create impersonation token: 500 Internal Server Error'
      )
    })
  })
})
