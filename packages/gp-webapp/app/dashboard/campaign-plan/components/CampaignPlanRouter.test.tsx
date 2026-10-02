import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { ReactNode } from 'react'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { formatInTimeZone } from 'date-fns-tz'
import { render } from 'helpers/test-utils/render'
import { useCampaign } from '@shared/hooks/useCampaign'
import CampaignPlanRouter from './CampaignPlanRouter'

vi.mock('@shared/hooks/useCampaign', () => ({
  useCampaign: vi.fn(),
}))
vi.mock('./CampaignPlanPage', () => ({
  default: () => <div data-testid="plan-page" />,
}))
vi.mock('./CampaignPlanGenerateGate', () => ({
  default: ({ onGenerate }: { onGenerate: () => void }) => (
    <button type="button" onClick={onGenerate}>
      generate
    </button>
  ),
}))
vi.mock('../../shared/DashboardLayout', () => ({
  default: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}))

const mockUseCampaign = vi.mocked(useCampaign)
const setElectionDate = (
  electionDate: string | undefined,
  primaryElectionDate?: string,
): void => {
  mockUseCampaign.mockReturnValue([
    { id: 1, details: { electionDate, primaryElectionDate } },
  ] as unknown as ReturnType<typeof useCampaign>)
}

const planPage = () => screen.queryByTestId('plan-page')
const generateButton = () => screen.queryByRole('button', { name: 'generate' })
const electionPassedGate = () =>
  screen.queryByRole('heading', { name: /election date has passed/i })

describe('CampaignPlanRouter', () => {
  beforeEach(() => {
    sessionStorage.clear()
    setElectionDate('2099-11-03')
  })

  it('routes a campaign whose election has passed to the update-your-race gate, even with a plan', () => {
    setElectionDate('2024-11-05')
    render(<CampaignPlanRouter initialUser={null} planExists />)
    expect(electionPassedGate()).toBeInTheDocument()
    expect(planPage()).not.toBeInTheDocument()
    expect(generateButton()).not.toBeInTheDocument()
  })

  it('does not let a generate request bypass the past-election gate', () => {
    setElectionDate('2024-11-05')
    sessionStorage.setItem(
      'campaignPlanGenerateRequestedAt',
      String(Date.now()),
    )
    render(<CampaignPlanRouter initialUser={null} planExists={false} />)
    expect(electionPassedGate()).toBeInTheDocument()
    expect(planPage()).not.toBeInTheDocument()
  })

  it('gates on a past primary when no general date is stored, showing that date', () => {
    setElectionDate(undefined, '2024-03-05')
    render(<CampaignPlanRouter initialUser={null} planExists />)
    expect(electionPassedGate()).toBeInTheDocument()
    expect(screen.getByText(/2024/)).toBeInTheDocument()
    expect(planPage()).not.toBeInTheDocument()
  })

  it('does not block when the general date is past but the primary is upcoming', () => {
    setElectionDate('2024-11-05', '2099-03-03')
    render(<CampaignPlanRouter initialUser={null} planExists />)
    expect(planPage()).toBeInTheDocument()
    expect(electionPassedGate()).not.toBeInTheDocument()
  })

  it('treats election day itself (in UTC) as upcoming', () => {
    setElectionDate(formatInTimeZone(new Date(), 'UTC', 'yyyy-MM-dd'))
    render(<CampaignPlanRouter initialUser={null} planExists />)
    expect(planPage()).toBeInTheDocument()
    expect(electionPassedGate()).not.toBeInTheDocument()
  })

  it('treats a missing election date as not passed', () => {
    setElectionDate(undefined)
    render(<CampaignPlanRouter initialUser={null} planExists />)
    expect(planPage()).toBeInTheDocument()
    expect(electionPassedGate()).not.toBeInTheDocument()
  })

  it('shows the generate gate for a user with no plan', () => {
    render(<CampaignPlanRouter initialUser={null} planExists={false} />)
    expect(generateButton()).toBeInTheDocument()
    expect(planPage()).not.toBeInTheDocument()
  })

  it('renders the plan once the user requests generation', async () => {
    render(<CampaignPlanRouter initialUser={null} planExists={false} />)
    await userEvent.click(screen.getByRole('button', { name: 'generate' }))
    expect(planPage()).toBeInTheDocument()
  })

  it('keeps showing the plan after navigating away mid-generation', async () => {
    sessionStorage.setItem(
      'campaignPlanGenerateRequestedAt',
      String(Date.now()),
    )
    render(<CampaignPlanRouter initialUser={null} planExists={false} />)
    expect(await screen.findByTestId('plan-page')).toBeInTheDocument()
  })

  it('ignores a stale generate request and shows the gate', () => {
    const sixteenMinutesAgo = Date.now() - 16 * 60 * 1000
    sessionStorage.setItem(
      'campaignPlanGenerateRequestedAt',
      String(sixteenMinutesAgo),
    )
    render(<CampaignPlanRouter initialUser={null} planExists={false} />)
    expect(generateButton()).toBeInTheDocument()
    expect(planPage()).not.toBeInTheDocument()
  })

  // The campaign story is no longer a precondition for the plan: it sharpens a
  // plan rather than gating one. The router must not consult story state at
  // all, so a campaign with a plan and no story renders the plan.
  it('shows the plan for a user with a plan regardless of story state', () => {
    render(<CampaignPlanRouter initialUser={null} planExists />)
    expect(planPage()).toBeInTheDocument()
    expect(generateButton()).not.toBeInTheDocument()
  })
})
