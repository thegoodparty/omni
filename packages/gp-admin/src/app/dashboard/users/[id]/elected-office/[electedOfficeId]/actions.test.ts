import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  dispatchCommunityIssues,
  dispatchMeetingAgent,
  getAgentJobsStatus,
  getBriefingDispatchPreview,
} from './actions'
import { PERMISSIONS } from '@/lib/permissions'

const mockHas = vi.fn()
const mockAuth = vi.fn()
vi.mock('@clerk/nextjs/server', () => ({
  auth: () => mockAuth(),
}))

const mockList = vi.fn()
const mockDispatch = vi.fn()
const mockDispatchPreview = vi.fn()
const mockIssuesDispatch = vi.fn()
vi.mock('@/shared/util/gpClient.util', () => ({
  gpAction: vi.fn(async (fn: (client: unknown) => unknown) =>
    fn({
      adminAgentRuns: { list: mockList },
      meetingBriefings: {
        dispatch: mockDispatch,
        dispatchPreview: mockDispatchPreview,
      },
      communityIssues: { dispatch: mockIssuesDispatch },
    })
  ),
}))

beforeEach(() => {
  vi.clearAllMocks()
  mockHas.mockReturnValue(true)
  mockAuth.mockReturnValue({ has: mockHas })
})

describe('getAgentJobsStatus', () => {
  beforeEach(() => {
    mockList.mockImplementation(async ({ experimentType }) => ({
      data: [{ runId: `run_${experimentType}` }],
      meta: { total: 1, offset: 0, limit: 1 },
    }))
  })

  it('throws when the caller lacks READ_AGENT_RUNS', async () => {
    mockHas.mockReturnValue(false)
    await expect(getAgentJobsStatus('eo-1')).rejects.toThrow(
      'Missing read_agent_runs permission'
    )
    expect(mockList).not.toHaveBeenCalled()
  })

  it('requests one run per experiment type and maps the latest', async () => {
    const status = await getAgentJobsStatus('eo-1')
    expect(mockList).toHaveBeenCalledTimes(4)
    expect(mockList).toHaveBeenCalledWith({
      organizationSlug: 'eo-1',
      experimentType: 'meeting_schedule',
      limit: 1,
    })
    expect(status).toEqual({
      meeting_schedule: { runId: 'run_meeting_schedule' },
      meeting_briefing: { runId: 'run_meeting_briefing' },
      top_community_issues: { runId: 'run_top_community_issues' },
      trending_issues: { runId: 'run_trending_issues' },
    })
  })

  it('maps a type to null when no run exists', async () => {
    mockList.mockResolvedValue({ data: [], meta: { total: 0 } })
    const status = await getAgentJobsStatus('eo-1')
    expect(status.meeting_schedule).toBeNull()
  })
})

describe('getBriefingDispatchPreview', () => {
  it('throws when the caller lacks READ_AGENT_RUNS', async () => {
    mockHas.mockReturnValue(false)
    await expect(getBriefingDispatchPreview('eo-1')).rejects.toThrow(
      'Missing read_agent_runs permission'
    )
    expect(mockDispatchPreview).not.toHaveBeenCalled()
  })

  it('delegates to the SDK with the elected office id', async () => {
    mockDispatchPreview.mockResolvedValue({ gateWouldDispatch: true })
    const preview = await getBriefingDispatchPreview('eo-1')
    expect(mockDispatchPreview).toHaveBeenCalledWith('eo-1')
    expect(preview).toEqual({ gateWouldDispatch: true })
  })
})

describe('dispatchMeetingAgent', () => {
  it('throws when the caller lacks WRITE_AGENT_RUNS', async () => {
    mockHas.mockReturnValue(false)
    await expect(
      dispatchMeetingAgent({
        electedOfficeId: 'eo-1',
        kind: 'briefing',
        useImminenceGate: true,
      })
    ).rejects.toThrow('Missing write_agent_runs permission')
    expect(mockDispatch).not.toHaveBeenCalled()
  })

  it('checks the WRITE_AGENT_RUNS permission', async () => {
    mockDispatch.mockResolvedValue({ dispatched: true, kind: 'briefing' })
    await dispatchMeetingAgent({
      electedOfficeId: 'eo-1',
      kind: 'briefing',
      useImminenceGate: true,
    })
    expect(mockHas).toHaveBeenCalledWith({
      permission: PERMISSIONS.WRITE_AGENT_RUNS,
    })
  })

  it('delegates the input to the SDK', async () => {
    mockDispatch.mockResolvedValue({ dispatched: true, kind: 'schedule' })
    const result = await dispatchMeetingAgent({
      electedOfficeId: 'eo-1',
      kind: 'schedule',
      useImminenceGate: false,
    })
    expect(mockDispatch).toHaveBeenCalledWith({
      electedOfficeId: 'eo-1',
      kind: 'schedule',
      useImminenceGate: false,
    })
    expect(result).toEqual({ dispatched: true, kind: 'schedule' })
  })
})

describe('dispatchCommunityIssues', () => {
  it('throws when the caller lacks WRITE_AGENT_RUNS', async () => {
    mockHas.mockReturnValue(false)
    await expect(dispatchCommunityIssues('eo-1')).rejects.toThrow(
      'Missing write_agent_runs permission'
    )
    expect(mockIssuesDispatch).not.toHaveBeenCalled()
  })

  it('wraps the org slug in an array for the SDK', async () => {
    mockIssuesDispatch.mockResolvedValue({ dispatched: 2, skipped: 0 })
    const result = await dispatchCommunityIssues('eo-1')
    expect(mockIssuesDispatch).toHaveBeenCalledWith({ orgSlugs: ['eo-1'] })
    expect(result).toEqual({ dispatched: 2, skipped: 0 })
  })
})
