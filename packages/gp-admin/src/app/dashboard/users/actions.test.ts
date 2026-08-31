import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { SdkError } from '@goodparty_org/sdk'
import {
  createImpersonationToken,
  createSignInLink,
  updateUser,
} from './actions'
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
const mockCreateSignInLink = vi.fn()
const mockUsersUpdate = vi.fn()
vi.mock('@/shared/util/gpClient.util', () => ({
  gpAction: vi.fn(async (fn: (client: unknown) => unknown) =>
    fn({
      admin: {
        impersonateUser: mockImpersonateUser,
        createSignInLink: mockCreateSignInLink,
      },
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

describe('createSignInLink', () => {
  const link = {
    url: 'http://localhost:4000/sign-in-link?token=abc123',
    expiresAt: '2026-08-28T18:00:00.000Z',
  }

  beforeEach(() => {
    vi.clearAllMocks()
    mockHas.mockReturnValue(false)
    mockAuth.mockReturnValue(makeAuthResult())
    mockCurrentUser.mockResolvedValue({
      primaryEmailAddress: { emailAddress: 'admin@goodparty.org' },
    })
    mockCreateSignInLink.mockResolvedValue(link)
  })

  describe('auth guards', () => {
    it('throws Not authenticated when no user', async () => {
      mockCurrentUser.mockResolvedValue(null)

      await expect(createSignInLink(1)).rejects.toThrow('Not authenticated')
    })

    it('throws Not authenticated when no orgId', async () => {
      mockAuth.mockReturnValue(makeAuthResult({ orgId: null }))

      await expect(createSignInLink(1)).rejects.toThrow('Not authenticated')
    })

    it('throws when the actor has no primary email', async () => {
      mockCurrentUser.mockResolvedValue({ primaryEmailAddress: null })

      await expect(createSignInLink(1)).rejects.toThrow(
        'Could not determine actor email'
      )
    })

    it('mints a link without any permission check', async () => {
      await expect(createSignInLink(1)).resolves.toEqual(link)
      expect(mockHas).not.toHaveBeenCalled()
    })
  })

  describe('gp-api delegation', () => {
    it('forwards the target user and the actor email', async () => {
      await createSignInLink(99)

      expect(mockCreateSignInLink).toHaveBeenCalledWith(
        99,
        'admin@goodparty.org'
      )
    })

    it('does not call the SDK when the actor email is missing', async () => {
      mockCurrentUser.mockResolvedValue({ primaryEmailAddress: null })

      await expect(createSignInLink(1)).rejects.toThrow()
      expect(mockCreateSignInLink).not.toHaveBeenCalled()
    })
  })

  describe('response handling', () => {
    it('returns the url and expiry on success', async () => {
      await expect(createSignInLink(1)).resolves.toEqual(link)
    })

    it('propagates errors from the SDK', async () => {
      mockCreateSignInLink.mockRejectedValue(new Error('SDK error'))

      await expect(createSignInLink(1)).rejects.toThrow('SDK error')
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

  it('returns a generic message for SDK errors without a parseable body', async () => {
    mockUsersUpdate.mockRejectedValue(new SdkError(0, 'socket hang up'))

    const result = await updateUser(42, { phone: '4155552671' })

    expect(result).toEqual({ error: 'Failed to save changes' })
  })

  it('rethrows non-SDK errors so they reach the error boundary', async () => {
    mockUsersUpdate.mockRejectedValue(new Error('revalidate blew up'))

    await expect(updateUser(42, { phone: '4155552671' })).rejects.toThrow(
      'revalidate blew up'
    )
  })
})
