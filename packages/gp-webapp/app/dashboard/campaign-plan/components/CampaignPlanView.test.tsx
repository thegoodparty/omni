import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { render } from 'helpers/test-utils/render'
import { useCampaignPlanData } from 'app/onboarding/success/hooks/useCampaignPlanData'
import CampaignPlanView from './CampaignPlanView'

vi.mock('@shared/hooks/useCampaign', () => ({
  useCampaign: () => [{ id: 1, details: {} }],
}))
vi.mock('app/onboarding/success/hooks/useCampaignPlanData', () => ({
  useCampaignPlanData: vi.fn(),
}))
vi.mock('app/onboarding/success/hooks/useGenerationTiming', () => ({
  useGenerationTiming: () => () => ({}),
}))
vi.mock('app/onboarding/success/pdf/downloadCampaignPlanPdf', () => ({
  downloadCampaignPlanPdf: vi.fn(),
}))
vi.mock('./campaignStrategy/CampaignStrategySection', () => ({
  default: () => <div data-testid="tracker-section" />,
}))
vi.mock('../../components/campaignManager/ProgressSection', () => ({
  default: () => <div data-testid="progress-section" />,
}))
vi.mock('@shared/hooks/VoterContactsProvider', () => ({
  VoterContactsProvider: ({ children }: { children: React.ReactNode }) =>
    children,
}))
vi.mock('@shared/hooks/CampaignUpdateHistoryProvider', () => ({
  CampaignUpdateHistoryProvider: ({
    children,
  }: {
    children: React.ReactNode
  }) => children,
}))
vi.mock('./CampaignTrackerHero', () => ({
  default: () => <div data-testid="tracker-hero" />,
}))
vi.mock('app/onboarding/success/components/PlanView', () => ({
  default: ({
    showHero,
    showBottomBar,
  }: {
    showHero?: boolean
    showBottomBar?: boolean
  }) => (
    <div
      data-testid="plan-view"
      data-show-hero={showHero !== false}
      data-show-bottom-bar={showBottomBar !== false}
    />
  ),
}))

const mockData = vi.mocked(useCampaignPlanData)

const planData = () =>
  ({
    campaignId: 1,
    plan: { candidateName: 'Jane', race: 'Mayor', electionDate: '2026-11-03' },
    planReady: true,
    state: 'CA',
    strategyState: { isGenerating: false, isError: false },
    pressOutletsState: { isGenerating: false, isError: false },
    voterInsightsContext: {},
    strategy: { ready: true, isGenerating: false },
    media: { ready: true, isGenerating: false, outletCount: 0 },
  }) as never

describe('CampaignPlanView', () => {
  beforeEach(() => {
    mockData.mockReturnValue(planData())
  })

  it('renders the tracker with the plan below it, hero + bottom bar hidden', async () => {
    render(<CampaignPlanView initialUser={null} />)
    expect(screen.getByTestId('tracker-hero')).toBeInTheDocument()
    expect(screen.getByTestId('tracker-section')).toBeInTheDocument()
    // The plan starts folded into its card; open it to reach the plan.
    expect(screen.queryByTestId('plan-view')).not.toBeInTheDocument()
    await userEvent.click(
      screen.getByRole('button', { name: /executive summary/i }),
    )
    const planView = screen.getByTestId('plan-view')
    expect(planView).toHaveAttribute('data-show-hero', 'false')
    // The tracker hides the plan's bottom bar so it doesn't overlap the
    // always-present Campaign Manager footer chat dock.
    expect(planView).toHaveAttribute('data-show-bottom-bar', 'false')
  })

  it('calls useCampaignPlanData with just the current user', () => {
    render(<CampaignPlanView initialUser={null} />)
    expect(mockData).toHaveBeenCalledWith(null)
  })
})
