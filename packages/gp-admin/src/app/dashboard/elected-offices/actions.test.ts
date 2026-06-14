import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  listElectedOffices,
  getElectedOffice,
  updateElectedOffice,
} from './actions'
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
    fn({
      electedOffices: { list: mockList, get: mockGet, update: mockUpdate },
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
  mockList.mockResolvedValue({
    data: [],
    meta: { total: 0, offset: 0, limit: 0 },
  })
  mockGet.mockResolvedValue({ id: 'eo_1' })
  mockUpdate.mockResolvedValue({ id: 'eo_1' })
})

describe('listElectedOffices', () => {
  it('throws when the caller lacks READ_CAMPAIGNS', async () => {
    mockHas.mockReturnValue(false)
    await expect(listElectedOffices(1)).rejects.toThrow(
      'Missing read_campaigns permission'
    )
    expect(mockList).not.toHaveBeenCalled()
  })

  it('throws a clean permission error (not a TypeError) when unauthenticated', async () => {
    // Clerk auth() returns has: null for an unauthenticated session.
    mockAuth.mockReturnValue(makeAuthResult({ has: null }))
    await expect(listElectedOffices(1)).rejects.toThrow(
      'Missing read_campaigns permission'
    )
    expect(mockList).not.toHaveBeenCalled()
  })

  it('checks the READ_CAMPAIGNS permission', async () => {
    await listElectedOffices(1)
    expect(mockHas).toHaveBeenCalledWith({
      permission: PERMISSIONS.READ_CAMPAIGNS,
    })
  })
})

describe('getElectedOffice', () => {
  it('throws when the caller lacks READ_CAMPAIGNS', async () => {
    mockHas.mockReturnValue(false)
    await expect(getElectedOffice('eo_1')).rejects.toThrow(
      'Missing read_campaigns permission'
    )
    expect(mockGet).not.toHaveBeenCalled()
  })

  it('checks the READ_CAMPAIGNS permission', async () => {
    await getElectedOffice('eo_1')
    expect(mockHas).toHaveBeenCalledWith({
      permission: PERMISSIONS.READ_CAMPAIGNS,
    })
  })
})

describe('updateElectedOffice', () => {
  it('throws when the caller lacks WRITE_CAMPAIGNS', async () => {
    mockHas.mockReturnValue(false)
    await expect(updateElectedOffice('eo_1', 2, {})).rejects.toThrow(
      'Missing write_campaigns permission'
    )
    expect(mockUpdate).not.toHaveBeenCalled()
  })

  it('checks the WRITE_CAMPAIGNS permission and forwards to the SDK', async () => {
    await updateElectedOffice('eo_1', 2, { title: 'x' } as Parameters<
      typeof updateElectedOffice
    >[2])
    expect(mockHas).toHaveBeenCalledWith({
      permission: PERMISSIONS.WRITE_CAMPAIGNS,
    })
    expect(mockUpdate).toHaveBeenCalledWith('eo_1', { title: 'x' })
  })
})
