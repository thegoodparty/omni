import { describe, expect, it, vi, beforeEach } from 'vitest'
import { ROLES } from '@/lib/permissions'
import { SdkError } from '@/shared/gpApi'
import {
  deleteJobDeadLetter,
  deleteJobDeadLetters,
  getJobDeadLetter,
  listJobDeadLetters,
  redriveJobDeadLetter,
  redriveJobDeadLetters,
} from './actions'

const mockHas = vi.fn()
const mockAuth = vi.fn()
vi.mock('@clerk/nextjs/server', () => ({
  auth: () => mockAuth(),
}))

const mockList = vi.fn()
const mockGet = vi.fn()
const mockRedrive = vi.fn()
const mockDelete = vi.fn()
const mockRedriveMany = vi.fn()
const mockDeleteMany = vi.fn()
vi.mock('@/shared/util/gpClient.util', () => ({
  gpAction: vi.fn(async (fn: (client: unknown) => unknown) =>
    fn({
      adminJobDeadLetters: {
        list: mockList,
        get: mockGet,
        redrive: mockRedrive,
        delete: mockDelete,
        redriveMany: mockRedriveMany,
        deleteMany: mockDeleteMany,
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
    mockDelete.mockResolvedValue({ id: 'dl_1' })
    mockRedriveMany.mockResolvedValue({ redriven: ['dl_1'], failed: [] })
    mockDeleteMany.mockResolvedValue({ deleted: ['dl_1'], failed: [] })
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

  it('returns the API message when the redrive answers 409', async () => {
    mockRedrive.mockRejectedValue(
      new SdkError(409, 'Conflict', undefined, {
        message: 'Dead letter dl_1 was already redriven',
      })
    )

    await expect(redriveJobDeadLetter('dl_1')).resolves.toEqual({
      error: 'Dead letter dl_1 was already redriven',
    })
  })

  it('returns the role error instead of throwing for a non-admin redrive', async () => {
    mockHas.mockReturnValue(false)

    await expect(redriveJobDeadLetter('dl_1')).resolves.toEqual({
      error: 'Only admins can redrive a job dead letter',
    })
    expect(mockRedrive).not.toHaveBeenCalled()
  })

  it('deletes through the SDK and reports no error', async () => {
    await expect(deleteJobDeadLetter('dl_1')).resolves.toEqual({ error: null })
    expect(mockDelete).toHaveBeenCalledWith('dl_1')
  })

  it('returns the API message when the delete answers 404', async () => {
    mockDelete.mockRejectedValue(
      new SdkError(404, 'Not Found', undefined, {
        message: 'No dead letter dl_1',
      })
    )

    await expect(deleteJobDeadLetter('dl_1')).resolves.toEqual({
      error: 'No dead letter dl_1',
    })
  })

  it('returns the role error instead of throwing for a non-admin delete', async () => {
    mockHas.mockReturnValue(false)

    await expect(deleteJobDeadLetter('dl_1')).resolves.toEqual({
      error: 'Only admins can delete a job dead letter',
    })
    expect(mockDelete).not.toHaveBeenCalled()
  })

  it('re-drives a batch and passes the per-entry failures through', async () => {
    mockRedriveMany.mockResolvedValue({
      redriven: ['dl_1'],
      failed: [{ id: 'dl_2', message: 'records no source queue' }],
    })

    await expect(redriveJobDeadLetters(['dl_1', 'dl_2'])).resolves.toEqual({
      redriven: ['dl_1'],
      failed: [{ id: 'dl_2', message: 'records no source queue' }],
    })
    expect(mockRedriveMany).toHaveBeenCalledWith(['dl_1', 'dl_2'])
  })

  it('deletes a batch and passes the per-entry failures through', async () => {
    await expect(deleteJobDeadLetters(['dl_1'])).resolves.toEqual({
      deleted: ['dl_1'],
      failed: [],
    })
    expect(mockDeleteMany).toHaveBeenCalledWith(['dl_1'])
  })

  it('returns an error instead of throwing when the whole batch request fails', async () => {
    mockDeleteMany.mockRejectedValue(
      new SdkError(503, 'Service Unavailable', undefined, {
        message: 'gp-api is unreachable',
      })
    )

    await expect(deleteJobDeadLetters(['dl_1'])).resolves.toEqual({
      error: 'gp-api is unreachable',
    })
  })

  it('refuses a batch for a caller who is not an admin', async () => {
    mockHas.mockReturnValue(false)

    await expect(redriveJobDeadLetters(['dl_1'])).resolves.toEqual({
      error: 'Only admins can redrive job dead letters',
    })
    expect(mockRedriveMany).not.toHaveBeenCalled()
  })
})
