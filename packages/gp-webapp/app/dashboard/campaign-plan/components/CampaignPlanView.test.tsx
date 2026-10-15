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
// The Summary card rides into the tracker's body, so the stub renders it.
vi.mock('./campaignStrategy/CampaignStrategySection', () => ({
  default: ({ bodyStart }: { bodyStart?: React.ReactNode }) => (
    <div data-testid="tracker-section">{bodyStart}</div>
  ),
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

  it('opens the whole plan in a modal from the Campaign strategy card, bottom bar hidden', async () => {
    render(<CampaignPlanView initialUser={null} />)
    expect(screen.getByTestId('tracker-section')).toBeInTheDocument()
    // The plan stays closed behind its card until the card is opened.
    expect(screen.queryByTestId('plan-view')).not.toBeInTheDocument()
    await userEvent.click(
      screen.getByRole('button', { name: /campaign strategy/i }),
    )
    expect(
      screen.getByRole('dialog', { name: 'Campaign strategy' }),
    ).toBeInTheDocument()
    const planView = screen.getByTestId('plan-view')
    expect(planView).toHaveAttribute('data-show-hero', 'false')
    // The tracker hides the plan's bottom bar so it doesn't overlap the
    // always-present Campaign Manager footer chat dock.
    expect(planView).toHaveAttribute('data-show-bottom-bar', 'false')
  })

  it('calls useCampaignPlanData with the current user and the tracker’s start', () => {
    render(<CampaignPlanView initialUser={null} />)
    // No tracker rows yet, so no start: the plan starts today.
    expect(mockData).toHaveBeenCalledWith(null, null)
  })
})
