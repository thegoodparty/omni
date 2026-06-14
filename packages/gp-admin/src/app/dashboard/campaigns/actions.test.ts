import { describe, it, expect, vi, beforeEach } from 'vitest'
import { listCampaigns, getCampaign, updateCampaign } from './actions'
import { PERMISSIONS } from '@/lib/permissions'

// --- Clerk server auth ---
const mockHas = vi.fn()
const mockAuth = vi.fn()
vi.mock('@clerk/nextjs/server', () => ({
  auth: () => mockAuth(),
}))

// --- GP API client ---
const mockList = vi.fn()
const mockGet = vi.fn()
const mockUpdate = vi.fn()
vi.mock('@/shared/util/gpClient.util', () => ({
  gpAction: vi.fn(async (fn: (client: unknown) => unknown) =>
    fn({ campaigns: { list: mockList, get: mockGet, update: mockUpdate } })
  ),
}))

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

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
  mockList.mockResolvedValue({
    data: [],
    meta: { total: 0, offset: 0, limit: 0 },
  })
  mockGet.mockResolvedValue({ id: 1 })
  mockUpdate.mockResolvedValue({ id: 1 })
})

describe('listCampaigns', () => {
  it('throws when the caller lacks READ_CAMPAIGNS', async () => {
    mockHas.mockReturnValue(false)
    await expect(listCampaigns(1)).rejects.toThrow(
      'Missing read_campaigns permission'
    )
    expect(mockList).not.toHaveBeenCalled()
  })

  it('throws a clean permission error (not a TypeError) when unauthenticated', async () => {
    // Clerk auth() returns has: null for an unauthenticated session; the guard
    // must use has?.() so a direct Next-Action POST without a session fails
    // closed instead of throwing "has is not a function".
    mockAuth.mockReturnValue(makeAuthResult({ has: null }))
    await expect(listCampaigns(1)).rejects.toThrow(
      'Missing read_campaigns permission'
    )
    expect(mockList).not.toHaveBeenCalled()
  })

  it('checks the READ_CAMPAIGNS permission', async () => {
    await listCampaigns(1)
    expect(mockHas).toHaveBeenCalledWith({
      permission: PERMISSIONS.READ_CAMPAIGNS,
    })
  })
})

describe('getCampaign', () => {
  it('throws when the caller lacks READ_CAMPAIGNS', async () => {
    mockHas.mockReturnValue(false)
    await expect(getCampaign(1)).rejects.toThrow(
      'Missing read_campaigns permission'
    )
    expect(mockGet).not.toHaveBeenCalled()
  })

  it('checks the READ_CAMPAIGNS permission', async () => {
    await getCampaign(1)
    expect(mockHas).toHaveBeenCalledWith({
      permission: PERMISSIONS.READ_CAMPAIGNS,
    })
  })
})

describe('updateCampaign', () => {
  it('throws when the caller lacks WRITE_CAMPAIGNS', async () => {
    mockHas.mockReturnValue(false)
    await expect(updateCampaign(1, 2, {})).rejects.toThrow(
      'Missing write_campaigns permission'
    )
    expect(mockUpdate).not.toHaveBeenCalled()
  })

  it('checks the WRITE_CAMPAIGNS permission and forwards to the SDK', async () => {
    await updateCampaign(1, 2, { name: 'x' } as Parameters<
      typeof updateCampaign
    >[2])
    expect(mockHas).toHaveBeenCalledWith({
      permission: PERMISSIONS.WRITE_CAMPAIGNS,
    })
    expect(mockUpdate).toHaveBeenCalledWith(1, { name: 'x' })
  })
})
