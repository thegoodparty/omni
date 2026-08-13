import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen } from '@testing-library/react'
import { render } from 'helpers/test-utils/render'
import { useCampaignStoryFlag } from '@shared/experiments/campaignStoryFlag'
import { useCampaignPlanData } from 'app/onboarding/success/hooks/useCampaignPlanData'
import CampaignPlanView from './CampaignPlanView'

vi.mock('@shared/experiments/campaignStoryFlag', () => ({
  useCampaignStoryFlag: vi.fn(),
}))
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
vi.mock('./CampaignTrackerHero', () => ({
  default: () => <div data-testid="tracker-hero" />,
}))
// PlanView surfaces whether it received eventsState (the story-off community
// events section), whether its own hero is shown, and whether the fixed bottom
// bar (with the "Campaign Manager" button) is shown.
vi.mock('app/onboarding/success/components/PlanView', () => ({
  default: ({
    eventsState,
    showHero,
    showBottomBar,
  }: {
    eventsState?: unknown
    showHero?: boolean
    showBottomBar?: boolean
  }) => (
    <div
      data-testid="plan-view"
      data-has-events={eventsState !== undefined}
      data-show-hero={showHero !== false}
      data-show-bottom-bar={showBottomBar !== false}
    />
  ),
}))

const mockFlag = vi.mocked(useCampaignStoryFlag)
const mockData = vi.mocked(useCampaignPlanData)

const planData = (eventsEnabled: boolean) =>
  ({
    campaignId: 1,
    plan: { candidateName: 'Jane', race: 'Mayor', electionDate: '2026-11-03' },
    planReady: true,
    state: 'CA',
    strategyState: { isGenerating: false, isError: false },
    // useCampaignPlanData returns eventsState as not-generating either way; the
    // section only renders when PlanView is handed eventsState (story-off).
    eventsState: { isGenerating: false, isError: false },
    pressOutletsState: { isGenerating: false, isError: false },
    voterInsightsContext: {},
    strategy: { ready: true, isGenerating: false },
    communityEvents: {
      ready: eventsEnabled,
      isGenerating: false,
      eventCount: 0,
    },
    media: { ready: true, isGenerating: false, outletCount: 0 },
  }) as never

describe('CampaignPlanView cohort gating', () => {
  beforeEach(() => {
    mockData.mockReturnValue(planData(false))
  })

  it('shows a spinner until the story flag resolves', () => {
    mockFlag.mockReturnValue({ ready: false, enabled: false })
    render(<CampaignPlanView initialUser={null} />)
    expect(screen.queryByTestId('tracker-section')).not.toBeInTheDocument()
    expect(screen.queryByTestId('plan-view')).not.toBeInTheDocument()
  })

  it('renders the tracker (and hides the plan events section) for the story cohort', () => {
    mockFlag.mockReturnValue({ ready: true, enabled: true })
    render(<CampaignPlanView initialUser={null} />)
    expect(screen.getByTestId('tracker-hero')).toBeInTheDocument()
    expect(screen.getByTestId('tracker-section')).toBeInTheDocument()
    const planView = screen.getByTestId('plan-view')
    expect(planView).toHaveAttribute('data-has-events', 'false')
    expect(planView).toHaveAttribute('data-show-hero', 'false')
    // The story tracker hides the plan's bottom bar so it doesn't overlap the
    // always-present Campaign Manager footer chat dock.
    expect(planView).toHaveAttribute('data-show-bottom-bar', 'false')
  })

  it('renders the legacy plan with community events and NO tracker for story-off', () => {
    mockFlag.mockReturnValue({ ready: true, enabled: false })
    render(<CampaignPlanView initialUser={null} />)
    expect(screen.queryByTestId('tracker-hero')).not.toBeInTheDocument()
    expect(screen.queryByTestId('tracker-section')).not.toBeInTheDocument()
    const planView = screen.getByTestId('plan-view')
    expect(planView).toHaveAttribute('data-has-events', 'true')
    expect(planView).toHaveAttribute('data-show-hero', 'true')
    // Story-off keeps the plan's bottom bar (its "Campaign Manager" button
    // navigates home; no footer dock is mounted for that cohort).
    expect(planView).toHaveAttribute('data-show-bottom-bar', 'true')
  })

  it('disables the legacy community-events poll for the story cohort', () => {
    mockFlag.mockReturnValue({ ready: true, enabled: true })
    render(<CampaignPlanView initialUser={null} />)
    // useCampaignPlanData(initialUser, communityEventsEnabled) — story-on must
    // pass false so the legacy events endpoint is never polled.
    expect(mockData).toHaveBeenCalledWith(null, false)
  })

  it('enables the legacy community-events poll for story-off', () => {
    mockFlag.mockReturnValue({ ready: true, enabled: false })
    render(<CampaignPlanView initialUser={null} />)
    expect(mockData).toHaveBeenCalledWith(null, true)
  })
})
