import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'

import { render } from 'helpers/test-utils/render'
import CampaignManager from './CampaignManager'

const mockUseCampaign = vi.fn()
const mockUsePostElectionState = vi.fn()

vi.mock('app/dashboard/shared/DashboardLayout', () => ({
  default: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}))
vi.mock('./HeaderSection', () => ({ default: () => <div>Header</div> }))
vi.mock('./ProgressSection', () => ({ default: () => <div>Progress</div> }))
vi.mock('./ProUpgradeBanner', () => ({
  default: () => <div>Pro upgrade banner</div>,
}))
vi.mock('./ProUpgrade3ComplianceCard', () => ({ default: () => null }))
vi.mock('@shared/hooks/VoterContactsProvider', () => ({
  VoterContactsProvider: ({ children }: { children: ReactNode }) => (
    <>{children}</>
  ),
}))
vi.mock('@shared/hooks/CampaignUpdateHistoryProvider', () => ({
  CampaignUpdateHistoryProvider: ({ children }: { children: ReactNode }) => (
    <>{children}</>
  ),
}))
vi.mock('@shared/hooks/useCampaign', () => ({
  useCampaign: () => mockUseCampaign(),
}))
vi.mock('@shared/hooks/usePositionName', () => ({
  usePositionName: () => 'Mayor',
}))
vi.mock('../usePostElectionState', () => ({
  usePostElectionState: () => mockUsePostElectionState(),
}))
vi.mock('../ElectionOver', () => ({
  default: () => <div>Election over</div>,
}))
vi.mock('../PrimaryResultModal', () => ({
  default: () => null,
}))

beforeEach(() => {
  vi.clearAllMocks()
  mockUseCampaign.mockReturnValue([
    { id: 'campaign-1', isPro: false, details: { electionDate: '2026-11-03' } },
  ])
  mockUsePostElectionState.mockReturnValue({
    electionInPast: false,
    primaryLost: false,
    primaryResultModalOpen: false,
    primaryElectionDate: undefined,
    electionDate: '2026-11-03',
    closePrimaryResultModal: vi.fn(),
  })
})

describe('CampaignManager', () => {
  it('points to the Campaign Plan (no legacy task list)', () => {
    render(<CampaignManager pathname="/dashboard" tcrCompliance={null} />)
    expect(screen.getByText('Go to Campaign Plan')).toBeInTheDocument()
    expect(screen.getByText('Header')).toBeInTheDocument()
    expect(screen.getByText('Progress')).toBeInTheDocument()
  })

  it('renders ElectionOver and hides the rest when the election is in the past', () => {
    mockUsePostElectionState.mockReturnValue({
      electionInPast: true,
      primaryLost: false,
      primaryResultModalOpen: false,
      primaryElectionDate: undefined,
      electionDate: '2026-01-01',
      closePrimaryResultModal: vi.fn(),
    })

    render(<CampaignManager pathname="/dashboard" tcrCompliance={null} />)

    expect(screen.getByText('Election over')).toBeInTheDocument()
    expect(screen.queryByText('Header')).not.toBeInTheDocument()
    expect(screen.queryByText('Go to Campaign Plan')).not.toBeInTheDocument()
  })
})
