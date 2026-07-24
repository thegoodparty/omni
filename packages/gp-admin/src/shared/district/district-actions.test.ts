import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  fetchDistrictTypes,
  fetchDistrictNames,
  updateCampaignDistrict,
  updateElectedOfficeDistrict,
} from './district-actions'
import { PERMISSIONS } from '@/lib/permissions'

// --- Clerk server auth ---
const mockHas = vi.fn()
const mockAuth = vi.fn()
vi.mock('@clerk/nextjs/server', () => ({
  auth: () => mockAuth(),
}))

// --- GP API client ---
const mockListTypes = vi.fn()
const mockListNames = vi.fn()
const mockUpdateDistrict = vi.fn()
const mockUpdateElectedOfficeDistrict = vi.fn()
vi.mock('@/shared/util/gpClient.util', () => ({
  gpAction: vi.fn(async (fn: (client: unknown) => unknown) =>
    fn({
      elections: {
        listDistrictTypes: mockListTypes,
        listDistrictNames: mockListNames,
      },
      campaigns: { updateDistrict: mockUpdateDistrict },
      electedOffices: { updateDistrict: mockUpdateElectedOfficeDistrict },
    })
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
  mockListTypes.mockResolvedValue([])
  mockListNames.mockResolvedValue([])
  mockUpdateDistrict.mockResolvedValue(undefined)
  mockUpdateElectedOfficeDistrict.mockResolvedValue(undefined)
})

describe('fetchDistrictTypes', () => {
  it('throws when the caller lacks READ_CAMPAIGNS', async () => {
    mockHas.mockReturnValue(false)
    await expect(fetchDistrictTypes('CA', 2026)).rejects.toThrow(
      'Missing read_campaigns permission'
    )
    expect(mockListTypes).not.toHaveBeenCalled()
  })

  it('throws a clean permission error (not a TypeError) when unauthenticated', async () => {
    // Clerk auth() returns has: null for an unauthenticated session.
    mockAuth.mockReturnValue(makeAuthResult({ has: null }))
    await expect(fetchDistrictTypes('CA', 2026)).rejects.toThrow(
      'Missing read_campaigns permission'
    )
    expect(mockListTypes).not.toHaveBeenCalled()
  })

  it('checks the READ_CAMPAIGNS permission', async () => {
    await fetchDistrictTypes('CA', 2026)
    expect(mockHas).toHaveBeenCalledWith({
      permission: PERMISSIONS.READ_CAMPAIGNS,
    })
  })
})

describe('fetchDistrictNames', () => {
  it('throws when the caller lacks READ_CAMPAIGNS', async () => {
    mockHas.mockReturnValue(false)
    await expect(fetchDistrictNames('CA', 2026, 'City')).rejects.toThrow(
      'Missing read_campaigns permission'
    )
    expect(mockListNames).not.toHaveBeenCalled()
  })

  it('checks READ_CAMPAIGNS and forwards to the SDK', async () => {
    await fetchDistrictNames('CA', 2026, 'City')
    expect(mockHas).toHaveBeenCalledWith({
      permission: PERMISSIONS.READ_CAMPAIGNS,
    })
    expect(mockListNames).toHaveBeenCalled()
  })
})

describe('updateCampaignDistrict', () => {
  it('throws when the caller lacks WRITE_CAMPAIGNS', async () => {
    mockHas.mockReturnValue(false)
    await expect(
      updateCampaignDistrict(1, 'City', 'Springfield', 2)
    ).rejects.toThrow('Missing write_campaigns permission')
    expect(mockUpdateDistrict).not.toHaveBeenCalled()
  })

  it('checks WRITE_CAMPAIGNS and forwards to the SDK', async () => {
    await updateCampaignDistrict(1, 'City', 'Springfield', 2)
    expect(mockHas).toHaveBeenCalledWith({
      permission: PERMISSIONS.WRITE_CAMPAIGNS,
    })
    expect(mockUpdateDistrict).toHaveBeenCalledWith(1, {
      L2DistrictType: 'City',
      L2DistrictName: 'Springfield',
    })
  })
})

describe('updateElectedOfficeDistrict', () => {
  it('throws when the caller lacks WRITE_CAMPAIGNS', async () => {
    mockHas.mockReturnValue(false)
    await expect(
      updateElectedOfficeDistrict('eo_1', 'CA', 'City', 'Springfield', 2)
    ).rejects.toThrow('Missing write_campaigns permission')
    expect(mockUpdateElectedOfficeDistrict).not.toHaveBeenCalled()
  })

  it('checks WRITE_CAMPAIGNS and forwards to the typed SDK method', async () => {
    await updateElectedOfficeDistrict('eo_1', 'CA', 'City', 'Springfield', 2)
    expect(mockHas).toHaveBeenCalledWith({
      permission: PERMISSIONS.WRITE_CAMPAIGNS,
    })
    expect(mockUpdateElectedOfficeDistrict).toHaveBeenCalledWith('eo_1', {
      state: 'CA',
      L2DistrictType: 'City',
      L2DistrictName: 'Springfield',
    })
  })
})
