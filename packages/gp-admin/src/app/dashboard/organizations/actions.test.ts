import { describe, it, expect, vi, beforeEach } from 'vitest'
import { getOrganization } from './actions'
import { PERMISSIONS } from '@/lib/permissions'

// --- Clerk server auth ---
const mockHas = vi.fn()
const mockAuth = vi.fn()
vi.mock('@clerk/nextjs/server', () => ({
  auth: () => mockAuth(),
}))

// --- GP API client ---
const mockGet = vi.fn()
vi.mock('@/shared/util/gpClient.util', () => ({
  gpAction: vi.fn(async (fn: (client: unknown) => unknown) =>
    fn({ organizations: { get: mockGet } })
  ),
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
  mockGet.mockResolvedValue({ slug: 'org-1' })
})

describe('getOrganization', () => {
  it('throws when the caller lacks READ_CAMPAIGNS', async () => {
    mockHas.mockReturnValue(false)
    await expect(getOrganization('org-1')).rejects.toThrow(
      'Missing read_campaigns permission'
    )
    expect(mockGet).not.toHaveBeenCalled()
  })

  it('checks the READ_CAMPAIGNS permission', async () => {
    await getOrganization('org-1')
    expect(mockHas).toHaveBeenCalledWith({
      permission: PERMISSIONS.READ_CAMPAIGNS,
    })
  })

  it('returns null on a 404 from the SDK', async () => {
    mockGet.mockRejectedValue({ status: 404 })
    await expect(getOrganization('missing')).resolves.toBeNull()
  })
})
