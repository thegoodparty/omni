import { describe, it, expect, vi, beforeEach } from 'vitest'
import { getOrganization, updateOrganizationPositionName } from './actions'
import { PERMISSIONS } from '@/lib/permissions'

// --- Clerk server auth ---
const mockHas = vi.fn()
const mockAuth = vi.fn()
vi.mock('@clerk/nextjs/server', () => ({
  auth: () => mockAuth(),
}))

// --- Next cache ---
const mockRevalidatePath = vi.fn()
vi.mock('next/cache', () => ({
  revalidatePath: (...args: unknown[]) => mockRevalidatePath(...args),
}))

// --- GP API client ---
const mockGet = vi.fn()
const mockPatch = vi.fn()
const mockCampaignUpdate = vi.fn()
vi.mock('@/shared/util/gpClient.util', () => ({
  gpAction: vi.fn(async (fn: (client: unknown) => unknown) =>
    fn({
      organizations: { get: mockGet, patch: mockPatch },
      campaigns: { update: mockCampaignUpdate },
    })
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
  mockPatch.mockResolvedValue({ slug: 'org-1' })
  mockCampaignUpdate.mockResolvedValue({ id: 1 })
})

describe('getOrganization', () => {
  it('throws when the caller lacks READ_CAMPAIGNS', async () => {
    mockHas.mockReturnValue(false)
    await expect(getOrganization('org-1')).rejects.toThrow(
      'Missing read_campaigns permission'
    )
    expect(mockGet).not.toHaveBeenCalled()
  })

  it('throws a clean permission error (not a TypeError) when unauthenticated', async () => {
    // Clerk auth() returns has: null for an unauthenticated session.
    mockAuth.mockReturnValue(makeAuthResult({ has: null }))
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

describe('updateOrganizationPositionName', () => {
  it('throws when the caller lacks WRITE_CAMPAIGNS', async () => {
    mockHas.mockReturnValue(false)
    await expect(
      updateOrganizationPositionName('campaign-1', 'Mayor', 1, 595)
    ).rejects.toThrow('Missing write_campaigns permission')
    expect(mockPatch).not.toHaveBeenCalled()
    expect(mockCampaignUpdate).not.toHaveBeenCalled()
  })

  it('throws a clean permission error when unauthenticated', async () => {
    mockAuth.mockReturnValue(makeAuthResult({ has: null }))
    await expect(
      updateOrganizationPositionName('campaign-1', 'Mayor', 1, 595)
    ).rejects.toThrow('Missing write_campaigns permission')
    expect(mockPatch).not.toHaveBeenCalled()
  })

  it('checks the WRITE_CAMPAIGNS permission', async () => {
    await updateOrganizationPositionName('campaign-1', 'Mayor', 1, 595)
    expect(mockHas).toHaveBeenCalledWith({
      permission: PERMISSIONS.WRITE_CAMPAIGNS,
    })
  })

  it('patches the org, then triggers the CRM re-sync campaign update', async () => {
    await updateOrganizationPositionName(
      'campaign-1',
      '(Port St. Lucie) City Council - District 1',
      1,
      595
    )

    expect(mockPatch).toHaveBeenCalledWith('campaign-1', {
      customPositionName: '(Port St. Lucie) City Council - District 1',
    })
    expect(mockCampaignUpdate).toHaveBeenCalledWith(1, {})
    expect(mockPatch.mock.invocationCallOrder[0]).toBeLessThan(
      mockCampaignUpdate.mock.invocationCallOrder[0]
    )
  })

  it('saves null to clear the override', async () => {
    await updateOrganizationPositionName('campaign-1', null, 1, 595)
    expect(mockPatch).toHaveBeenCalledWith('campaign-1', {
      customPositionName: null,
    })
  })

  it('revalidates the user layout after saving', async () => {
    await updateOrganizationPositionName('campaign-1', 'Mayor', 1, 595)
    expect(mockRevalidatePath).toHaveBeenCalledWith(
      '/dashboard/users/595',
      'layout'
    )
  })

  it('does not trigger the CRM re-sync when the org patch fails', async () => {
    mockPatch.mockRejectedValue(new Error('gp-api unavailable'))
    await expect(
      updateOrganizationPositionName('campaign-1', 'Mayor', 1, 595)
    ).rejects.toThrow('gp-api unavailable')
    expect(mockCampaignUpdate).not.toHaveBeenCalled()
    expect(mockRevalidatePath).not.toHaveBeenCalled()
  })
})
