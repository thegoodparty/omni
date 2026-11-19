import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PERMISSIONS } from '@/lib/permissions'
import { searchBackgroundAgentRuns } from './actions'
import { SEARCH_PARAMS } from './types'

const mockHas = vi.fn()
const mockAuth = vi.fn()
vi.mock('@clerk/nextjs/server', () => ({
  auth: () => mockAuth(),
}))

const mockList = vi.fn()
vi.mock('@/shared/util/gpClient.util', () => ({
  gpAction: vi.fn(async (fn: (client: unknown) => unknown) =>
    fn({ adminBackgroundAgentRuns: { list: mockList } })
  ),
}))

const makeAuthResult = (overrides: Record<string, unknown> = {}) => ({
  userId: 'user_admin_123',
  orgId: 'org_dev_123',
  has: mockHas,
  ...overrides,
})

describe('searchBackgroundAgentRuns', () => {
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
    await expect(searchBackgroundAgentRuns({})).rejects.toThrow(
      'Missing read_agent_runs permission'
    )
    expect(mockList).not.toHaveBeenCalled()
  })

  it('checks the READ_AGENT_RUNS permission', async () => {
    await searchBackgroundAgentRuns({})
    expect(mockHas).toHaveBeenCalledWith({
      permission: PERMISSIONS.READ_AGENT_RUNS,
    })
  })

  it('passes the mapped query to the SDK', async () => {
    await searchBackgroundAgentRuns({
      [SEARCH_PARAMS.AGENT_NAME]: 'trending_issues',
      [SEARCH_PARAMS.STATUS]: 'failed',
      [SEARCH_PARAMS.PAGE]: 2,
      [SEARCH_PARAMS.PER_PAGE]: 10,
    })
    expect(mockList).toHaveBeenCalledWith({
      limit: 10,
      offset: 10,
      agentName: 'trending_issues',
      status: 'failed',
    })
  })

  it('returns the SDK data and meta', async () => {
    const result = await searchBackgroundAgentRuns({})
    expect(result).toEqual({
      data: [{ runId: 'run_1' }],
      meta: { total: 1, offset: 0, limit: 20 },
    })
  })

  it('defaults data to an empty array when the SDK omits it', async () => {
    mockList.mockResolvedValue({ meta: { total: 0, offset: 0, limit: 20 } })
    const result = await searchBackgroundAgentRuns({})
    expect(result.data).toEqual([])
  })

  it('propagates SDK errors', async () => {
    mockList.mockRejectedValue(new Error('SDK error'))
    await expect(searchBackgroundAgentRuns({})).rejects.toThrow('SDK error')
  })
})
