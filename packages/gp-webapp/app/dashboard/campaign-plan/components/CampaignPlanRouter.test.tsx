import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { ReactNode } from 'react'
import { screen } from '@testing-library/react'
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
const electionPassedGate = () =>
  screen.queryByRole('heading', { name: /election date has passed/i })

describe('CampaignPlanRouter', () => {
  beforeEach(() => {
    setElectionDate('2099-11-03')
  })

  // Opening the tab is the request. Rendering the plan page is what fires the
  // generation POST, so "no plan yet" must still render it rather than asking.
  it('opens the plan without asking, so a candidate never generates it themselves', () => {
    render(<CampaignPlanRouter initialUser={null} />)
    expect(planPage()).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: /generate/i }),
    ).not.toBeInTheDocument()
  })

  it('routes a campaign whose election has passed to the update-your-race gate', () => {
    setElectionDate('2024-11-05')
    render(<CampaignPlanRouter initialUser={null} />)
    expect(electionPassedGate()).toBeInTheDocument()
    // Critically, the plan page never mounts, so nothing is dispatched for a
    // race that has already happened.
    expect(planPage()).not.toBeInTheDocument()
  })

  it('gates on a past primary when no general date is stored, showing that date', () => {
    setElectionDate(undefined, '2024-03-05')
    render(<CampaignPlanRouter initialUser={null} />)
    expect(electionPassedGate()).toBeInTheDocument()
    expect(screen.getByText(/2024/)).toBeInTheDocument()
    expect(planPage()).not.toBeInTheDocument()
  })

  it('does not block when the general date is past but the primary is upcoming', () => {
    setElectionDate('2024-11-05', '2099-03-03')
    render(<CampaignPlanRouter initialUser={null} />)
    expect(planPage()).toBeInTheDocument()
    expect(electionPassedGate()).not.toBeInTheDocument()
  })

  it('treats election day itself (in UTC) as upcoming', () => {
    setElectionDate(formatInTimeZone(new Date(), 'UTC', 'yyyy-MM-dd'))
    render(<CampaignPlanRouter initialUser={null} />)
    expect(planPage()).toBeInTheDocument()
    expect(electionPassedGate()).not.toBeInTheDocument()
  })

  it('treats a missing election date as not passed', () => {
    setElectionDate(undefined)
    render(<CampaignPlanRouter initialUser={null} />)
    expect(planPage()).toBeInTheDocument()
    expect(electionPassedGate()).not.toBeInTheDocument()
  })
})
