import { describe, expect, it, vi, beforeEach } from 'vitest'
import { ROLES } from '@/lib/permissions'
import {
  getJobDeadLetter,
  listJobDeadLetters,
  redriveJobDeadLetter,
} from './actions'

const mockHas = vi.fn()
const mockAuth = vi.fn()
vi.mock('@clerk/nextjs/server', () => ({
  auth: () => mockAuth(),
}))

const mockList = vi.fn()
const mockGet = vi.fn()
const mockRedrive = vi.fn()
vi.mock('@/shared/util/gpClient.util', () => ({
  gpAction: vi.fn(async (fn: (client: unknown) => unknown) =>
    fn({
      adminJobDeadLetters: {
        list: mockList,
        get: mockGet,
        redrive: mockRedrive,
      },
    })
  ),
}))

const makeAuthResult = (overrides: Record<string, unknown> = {}) => ({
  userId: 'user_admin_123',
  orgId: 'org_dev_123',
  has: mockHas,
  ...overrides,
})

describe('job dead letter actions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockHas.mockReturnValue(true)
    mockAuth.mockReturnValue(makeAuthResult())
    mockList.mockResolvedValue({
      data: [{ id: 'dl_1' }],
      meta: { total: 1, offset: 0, limit: 20 },
    })
    mockGet.mockResolvedValue({ id: 'dl_1' })
    mockRedrive.mockResolvedValue({ id: 'dl_1', sourceQueue: 'contracts' })
  })

  it('checks the org:admin role rather than a permission', async () => {
    await listJobDeadLetters({ offset: 0, limit: 20 })

    expect(mockHas).toHaveBeenCalledWith({ role: ROLES.ADMIN })
  })

  it('refuses to list for a caller who is not an admin', async () => {
    mockHas.mockReturnValue(false)

    await expect(listJobDeadLetters({ offset: 0, limit: 20 })).rejects.toThrow(
      'Only admins can read job dead letters'
    )
    expect(mockList).not.toHaveBeenCalled()
  })

  it('passes the paging and filter through to the SDK', async () => {
    await listJobDeadLetters({
      offset: 40,
      limit: 20,
      sourceQueue: 'contracts',
    })

    expect(mockList).toHaveBeenCalledWith({
      offset: 40,
      limit: 20,
      sourceQueue: 'contracts',
    })
  })

  it('refuses to read one dead letter for a caller who is not an admin', async () => {
    mockHas.mockReturnValue(false)

    await expect(getJobDeadLetter('dl_1')).rejects.toThrow(
      'Only admins can read a job dead letter'
    )
    expect(mockGet).not.toHaveBeenCalled()
  })

  it('reads one dead letter through the SDK', async () => {
    await expect(getJobDeadLetter('dl_1')).resolves.toEqual({ id: 'dl_1' })
    expect(mockGet).toHaveBeenCalledWith('dl_1')
  })

  it('redrives through the SDK and reports no error', async () => {
    await expect(redriveJobDeadLetter('dl_1')).resolves.toEqual({
      error: null,
    })
    expect(mockRedrive).toHaveBeenCalledWith('dl_1')
  })

  it('returns the error message instead of throwing when the redrive is refused', async () => {
    mockRedrive.mockRejectedValue(new Error('Dead letter dl_1 is gone'))

    await expect(redriveJobDeadLetter('dl_1')).resolves.toEqual({
      error: 'Dead letter dl_1 is gone',
    })
  })

  it('returns the role error instead of throwing for a non-admin redrive', async () => {
    mockHas.mockReturnValue(false)

    await expect(redriveJobDeadLetter('dl_1')).resolves.toEqual({
      error: 'Only admins can redrive a job dead letter',
    })
    expect(mockRedrive).not.toHaveBeenCalled()
  })
})
