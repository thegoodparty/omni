import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { SdkError } from '@goodparty_org/sdk'
import { createImpersonationToken, updateUser } from './actions'
import { PERMISSIONS } from '@/lib/permissions'
import { revalidatePath } from 'next/cache'

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
const mockUsersUpdate = vi.fn()
vi.mock('@/shared/util/gpClient.util', () => ({
  gpAction: vi.fn(async (fn: (client: unknown) => unknown) =>
    fn({
      admin: { impersonateUser: mockImpersonateUser },
      users: { update: mockUsersUpdate },
    })
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

describe('updateUser', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockHas.mockReturnValue(true)
    mockAuth.mockReturnValue(makeAuthResult())
  })

  it('throws when the write_users permission is missing', async () => {
    mockHas.mockReturnValue(false)
    await expect(updateUser(42, { phone: '4155552671' })).rejects.toThrow(
      'Missing write_users permission'
    )
  })

  it('returns the updated user and revalidates the user page', async () => {
    const user = { id: 42, phone: '4155552671' }
    mockUsersUpdate.mockResolvedValue(user)

    const result = await updateUser(42, { phone: '4155552671' })

    expect(mockUsersUpdate).toHaveBeenCalledWith(42, { phone: '4155552671' })
    expect(result).toEqual({ user })
    expect(revalidatePath).toHaveBeenCalledWith('/dashboard/users/42', 'layout')
  })

  it("returns the API's validation message instead of throwing on a 400", async () => {
    mockUsersUpdate.mockRejectedValue(
      new SdkError(400, '[PUT] "/v1/users/42": 400', undefined, {
        statusCode: 400,
        message: 'Validation failed',
        errors: [
          {
            code: 'custom',
            path: ['phone'],
            message: 'Must be valid phone number',
          },
        ],
      })
    )

    const result = await updateUser(42, { phone: 'not-a-phone' })

    expect(result).toEqual({
      error: 'Validation failed: phone: Must be valid phone number',
    })
  })

  it('returns a generic message for opaque failures', async () => {
    mockUsersUpdate.mockRejectedValue(new Error('socket hang up'))

    const result = await updateUser(42, { phone: '4155552671' })

    expect(result).toEqual({ error: 'Failed to save changes' })
  })
})
