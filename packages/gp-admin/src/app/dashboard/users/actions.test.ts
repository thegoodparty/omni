import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createImpersonationToken } from './actions'
import { PERMISSIONS } from '@/lib/permissions'

// --- next/cache ---
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

// --- Clerk server auth ---
const mockHas = vi.fn()
const mockAuth = vi.fn()
const mockCurrentUser = vi.fn()
vi.mock('@clerk/nextjs/server', () => ({
  auth: () => mockAuth(),
  currentUser: () => mockCurrentUser(),
}))

// --- GP API client ---
const mockImpersonateUser = vi.fn()
vi.mock('@/shared/util/gpClient.util', () => ({
  gpAction: vi.fn(async (fn: (client: unknown) => unknown) =>
    fn({ admin: { impersonateUser: mockImpersonateUser } })
  ),
}))

// --- GP Environment mock ---
vi.mock('@/shared/util/gpEnvironment', () => ({
  resolveEnvironment: vi.fn().mockReturnValue('dev'),
  GP_ENVIRONMENT: { DEV: 'dev', PROD: 'prod' },
}))

function makeAuthResult(overrides: Record<string, unknown> = {}) {
  return {
    userId: 'user_admin_123',
    orgId: 'org_dev_123',
    has: mockHas,
    ...overrides,
  }
}

describe('createImpersonationToken', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubEnv('NEXT_PUBLIC_GP_DEV_WEBAPP_URL', 'http://localhost:4000')
    mockHas.mockReturnValue(true)
    mockAuth.mockReturnValue(makeAuthResult())
    mockCurrentUser.mockResolvedValue({
      primaryEmailAddress: { emailAddress: 'admin@goodparty.org' },
    })
    mockImpersonateUser.mockResolvedValue({ token: 'clerk_ticket_xyz' })
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  describe('auth guards', () => {
    it('throws Not authenticated when no user', async () => {
      mockCurrentUser.mockResolvedValue(null)

      await expect(createImpersonationToken(1)).rejects.toThrow(
        'Not authenticated'
      )
    })

    it('throws Not authenticated when no orgId', async () => {
      mockAuth.mockReturnValue(makeAuthResult({ orgId: null }))
      await expect(createImpersonationToken(1)).rejects.toThrow(
        'Not authenticated'
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

  describe('gp-api delegation', () => {
    it('calls client.admin.impersonateUser with correct args', async () => {
      mockImpersonateUser.mockResolvedValue({ token: 'clerk_ticket_xyz' })
      await createImpersonationToken(99)

      expect(mockImpersonateUser).toHaveBeenCalledWith(
        99,
        'admin@goodparty.org'
      )
    })
  })

  describe('response handling', () => {
    it('returns token on success', async () => {
      mockImpersonateUser.mockResolvedValue({ token: 'clerk_ticket_xyz' })
      const result = await createImpersonationToken(1)
      expect(result).toEqual({
        token: 'clerk_ticket_xyz',
        webappUrl: 'http://localhost:4000',
      })
    })

    it('propagates errors from the SDK', async () => {
      mockImpersonateUser.mockRejectedValue(new Error('SDK error'))
      await expect(createImpersonationToken(1)).rejects.toThrow('SDK error')
    })
  })
})
