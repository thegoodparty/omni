import { describe, it, expect, vi, beforeEach } from 'vitest'
import { searchAgentRuns, retryAgentRun } from './actions'
import { SEARCH_PARAMS } from './types'
import { PERMISSIONS } from '@/lib/permissions'

// --- Clerk server auth ---
const mockHas = vi.fn()
const mockAuth = vi.fn()
vi.mock('@clerk/nextjs/server', () => ({
  auth: () => mockAuth(),
}))

// --- GP API client ---
const mockList = vi.fn()
const mockRetry = vi.fn()
vi.mock('@/shared/util/gpClient.util', () => ({
  gpAction: vi.fn(async (fn: (client: unknown) => unknown) =>
    fn({ adminAgentRuns: { list: mockList, retry: mockRetry } })
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

describe('searchAgentRuns', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockHas.mockReturnValue(true)
    mockAuth.mockReturnValue(makeAuthResult())
    mockList.mockResolvedValue({
      data: [{ runId: 'run_1' }],
      meta: { total: 1, offset: 0, limit: 20 },
    })
  })

  it('throws when the caller lacks READ_AGENT_RUNS', async () => {
    mockHas.mockReturnValue(false)
    await expect(searchAgentRuns({})).rejects.toThrow(
      'Missing read_agent_runs permission'
    )
    expect(mockList).not.toHaveBeenCalled()
  })

  it('checks the READ_AGENT_RUNS permission', async () => {
    await searchAgentRuns({})
    expect(mockHas).toHaveBeenCalledWith({
      permission: PERMISSIONS.READ_AGENT_RUNS,
    })
  })

  it('passes the mapped query to the SDK', async () => {
    await searchAgentRuns({
      [SEARCH_PARAMS.EXPERIMENT_TYPE]: 'compliance_setup',
      [SEARCH_PARAMS.STATUS]: 'FAILED',
      [SEARCH_PARAMS.PAGE]: 2,
      [SEARCH_PARAMS.PER_PAGE]: 10,
    })
    expect(mockList).toHaveBeenCalledWith({
      limit: 10,
      offset: 10,
      experimentType: 'compliance_setup',
      status: 'FAILED',
    })
  })

  it('returns the SDK data and meta', async () => {
    const result = await searchAgentRuns({})
    expect(result).toEqual({
      data: [{ runId: 'run_1' }],
      meta: { total: 1, offset: 0, limit: 20 },
    })
  })

  it('defaults data to an empty array when the SDK omits it', async () => {
    mockList.mockResolvedValue({ meta: { total: 0, offset: 0, limit: 20 } })
    const result = await searchAgentRuns({})
    expect(result.data).toEqual([])
  })

  it('propagates SDK errors', async () => {
    mockList.mockRejectedValue(new Error('SDK error'))
    await expect(searchAgentRuns({})).rejects.toThrow('SDK error')
  })
})

describe('retryAgentRun', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockHas.mockReturnValue(true)
    mockAuth.mockReturnValue(makeAuthResult())
    mockRetry.mockResolvedValue({ runId: 'run_new' })
  })

  it('throws when the caller lacks WRITE_AGENT_RUNS', async () => {
    mockHas.mockReturnValue(false)
    await expect(retryAgentRun('run_1')).rejects.toThrow(
      'Missing write_agent_runs permission'
    )
    expect(mockRetry).not.toHaveBeenCalled()
  })

  it('checks the WRITE_AGENT_RUNS permission', async () => {
    await retryAgentRun('run_1')
    expect(mockHas).toHaveBeenCalledWith({
      permission: PERMISSIONS.WRITE_AGENT_RUNS,
    })
  })

  it('calls the SDK with the run id and returns the new run id', async () => {
    const newRunId = await retryAgentRun('run_1')
    expect(mockRetry).toHaveBeenCalledWith('run_1')
    expect(newRunId).toBe('run_new')
  })

  it('propagates SDK errors', async () => {
    mockRetry.mockRejectedValue(new Error('SDK error'))
    await expect(retryAgentRun('run_1')).rejects.toThrow('SDK error')
  })
})
