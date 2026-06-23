import { describe, it, expect, vi, beforeEach } from 'vitest'
import { getOrganizationMembers } from './actions'
import { PERMISSIONS } from '@/lib/permissions'

// --- Clerk server auth ---
const mockHas = vi.fn()
const mockAuth = vi.fn()
const mockGetMembershipList = vi.fn()
vi.mock('@clerk/nextjs/server', () => ({
  auth: () => mockAuth(),
  clerkClient: () =>
    Promise.resolve({
      organizations: {
        getOrganizationMembershipList: (...args: unknown[]) =>
          mockGetMembershipList(...args),
      },
    }),
}))

function makeAuthResult(overrides: Record<string, unknown> = {}) {
  return {
    userId: 'user_admin_123',
    orgId: 'org_dev_123',
    has: mockHas,
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  mockHas.mockReturnValue(true)
  mockAuth.mockReturnValue(makeAuthResult())
  mockGetMembershipList.mockResolvedValue({ data: [{ id: 'mem_1' }] })
})

describe('getOrganizationMembers', () => {
  it('fails closed when the caller lacks MANAGE_INVITES', async () => {
    mockHas.mockReturnValue(false)
    const result = await getOrganizationMembers()
    expect(result).toEqual({
      success: false,
      error: 'Unauthorized: Missing manage_invites permission',
      data: [],
    })
    // The roster must never be fetched for an unauthorized caller.
    expect(mockGetMembershipList).not.toHaveBeenCalled()
  })

  it('fails closed (not a TypeError) when unauthenticated', async () => {
    // Clerk auth() returns has: null for an unauthenticated session, so the
    // gate must use optional-call (has?.) to fail closed rather than throw.
    mockAuth.mockReturnValue(makeAuthResult({ has: null }))
    const result = await getOrganizationMembers()
    expect(result.success).toBe(false)
    expect(mockGetMembershipList).not.toHaveBeenCalled()
  })

  it('checks the MANAGE_INVITES permission', async () => {
    await getOrganizationMembers()
    expect(mockHas).toHaveBeenCalledWith({
      permission: PERMISSIONS.MANAGE_INVITES,
    })
  })

  it('returns the membership roster for an authorized caller', async () => {
    const result = await getOrganizationMembers()
    expect(result).toEqual({ success: true, data: [{ id: 'mem_1' }] })
  })
})
