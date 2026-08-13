import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { ReactNode } from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import type { BriefingDispatchPreview } from '@goodparty_org/sdk'
import { AgentJobsPanel } from './AgentJobsPanel'
import type { AgentJobsStatus } from '../agentJobs'

const mockGetStatus = vi.fn()
const mockGetPreview = vi.fn()

vi.mock('../actions', () => ({
  getAgentJobsStatus: (...args: unknown[]) => mockGetStatus(...args),
  getBriefingDispatchPreview: (...args: unknown[]) => mockGetPreview(...args),
  dispatchMeetingAgent: vi.fn(),
  dispatchCommunityIssues: vi.fn(),
}))

vi.mock('@/components/ProtectedContent', () => ({
  ProtectedContent: ({ children }: { children: ReactNode }) => children,
}))

vi.mock('@/components/Toast', () => ({
  useToast: () => ({ showToast: vi.fn() }),
}))

vi.mock('next/link', () => ({
  default: ({ children }: { children: ReactNode }) => children,
}))

const emptyStatus: AgentJobsStatus = {
  meeting_schedule: null,
  meeting_briefing: null,
  top_community_issues: null,
  trending_issues: null,
}

const basePreview: BriefingDispatchPreview = {
  contextOk: true,
  isServeIcp: true,
  scheduleKnown: true,
  nextMeetingDate: null,
  imminentMeetingDate: null,
  coveredByBriefingDate: null,
  gateWouldDispatch: false,
  overrideWouldDispatch: true,
}

const renderPanel = () =>
  render(<AgentJobsPanel electedOfficeId="eo-1" organizationSlug="eo-1" />)

beforeEach(() => {
  vi.clearAllMocks()
  mockGetStatus.mockResolvedValue(emptyStatus)
})

describe('AgentJobsPanel briefing row', () => {
  it('shows the primary dispatch button when the gate would dispatch', async () => {
    mockGetPreview.mockResolvedValue({
      ...basePreview,
      gateWouldDispatch: true,
      imminentMeetingDate: '2026-07-05',
    })
    renderPanel()
    await waitFor(() =>
      expect(screen.getByText(/Gate will dispatch/)).toBeInTheDocument()
    )
    expect(
      screen.getByRole('button', { name: 'Dispatch briefing' })
    ).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Dispatch anyway' })
    ).not.toBeInTheDocument()
  })

  it('offers an enabled override when the gate skips a non-ICP office', async () => {
    mockGetPreview.mockResolvedValue({ ...basePreview, isServeIcp: false })
    renderPanel()
    await waitFor(() =>
      expect(screen.getByText(/not serve-ICP/)).toBeInTheDocument()
    )
    expect(
      screen.getByRole('button', { name: 'Dispatch anyway' })
    ).toBeEnabled()
  })

  it('explains a skip already covered by a briefing', async () => {
    mockGetPreview.mockResolvedValue({
      ...basePreview,
      coveredByBriefingDate: '2026-06-30',
    })
    renderPanel()
    await waitFor(() =>
      expect(
        screen.getByText(/already covered by a briefing/)
      ).toBeInTheDocument()
    )
  })

  it('disables the override when no meeting is found within 60 days', async () => {
    mockGetPreview.mockResolvedValue({
      ...basePreview,
      overrideWouldDispatch: false,
    })
    renderPanel()
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: 'Dispatch anyway' })
      ).toBeInTheDocument()
    )
    expect(
      screen.getByRole('button', { name: 'Dispatch anyway' })
    ).toBeDisabled()
    expect(screen.getByText(/60 days/)).toBeInTheDocument()
  })
})
