import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { ReactNode } from 'react'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { render } from 'helpers/test-utils/render'
import { router } from 'helpers/test-utils/router-mocking'
import { useCampaignStoryFlag } from '@shared/experiments/campaignStoryFlag'
import { useCampaignStrategyFlag } from '@shared/experiments/campaignStrategyFlag'
import CampaignPlanRouter from './CampaignPlanRouter'

vi.mock('@shared/experiments/campaignStoryFlag', () => ({
  useCampaignStoryFlag: vi.fn(),
}))
vi.mock('@shared/experiments/campaignStrategyFlag', () => ({
  useCampaignStrategyFlag: vi.fn(),
}))
vi.mock('./CampaignPlanPage', () => ({
  default: () => <div data-testid="plan-page" />,
}))
vi.mock('./CampaignPlanStoryGate', () => ({
  default: ({ onGenerate }: { onGenerate: () => void }) => (
    <button type="button" onClick={onGenerate}>
      generate
    </button>
  ),
}))
vi.mock('../../shared/DashboardLayout', () => ({
  default: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}))

const mockFlag = vi.mocked(useCampaignStoryFlag)
const mockStrategyFlag = vi.mocked(useCampaignStrategyFlag)
const setFlag = (ready: boolean, enabled: boolean): void => {
  mockFlag.mockReturnValue({ ready, enabled })
}
const setStrategyFlag = (ready: boolean, enabled: boolean): void => {
  mockStrategyFlag.mockReturnValue({ ready, enabled })
}

const planPage = () => screen.queryByTestId('plan-page')
const generateButton = () => screen.queryByRole('button', { name: 'generate' })

describe('CampaignPlanRouter', () => {
  beforeEach(() => {
    router.replace?.mockClear()
    sessionStorage.clear()
    setFlag(true, true)
    setStrategyFlag(true, false)
  })

  it('renders the plan immediately when one exists, ignoring the flag', () => {
    setFlag(false, false)
    render(<CampaignPlanRouter initialUser={null} planExists />)
    expect(planPage()).toBeInTheDocument()
  })

  it('shows a spinner while the flag is still loading', () => {
    setFlag(false, false)
    render(<CampaignPlanRouter initialUser={null} planExists={false} />)
    expect(planPage()).not.toBeInTheDocument()
    expect(generateButton()).not.toBeInTheDocument()
    expect(router.replace).not.toHaveBeenCalled()
  })

  it('redirects a non-flagged user with no plan to the dashboard', () => {
    setFlag(true, false)
    render(<CampaignPlanRouter initialUser={null} planExists={false} />)
    expect(router.replace).toHaveBeenCalledWith('/dashboard')
    expect(planPage()).not.toBeInTheDocument()
  })

  it('renders the generating plan for the strategy-only cohort (no story, no plan)', () => {
    setFlag(true, false)
    setStrategyFlag(true, true)
    render(<CampaignPlanRouter initialUser={null} planExists={false} />)
    expect(planPage()).toBeInTheDocument()
    expect(router.replace).not.toHaveBeenCalled()
  })

  it('redirects (never generates) when the flag is off, even with a stale generate request', async () => {
    setFlag(true, false)
    sessionStorage.setItem(
      'campaignPlanGenerateRequestedAt',
      String(Date.now()),
    )
    render(<CampaignPlanRouter initialUser={null} planExists={false} />)
    await waitFor(() =>
      expect(router.replace).toHaveBeenCalledWith('/dashboard'),
    )
    expect(planPage()).not.toBeInTheDocument()
  })

  it('shows the story gate for a flagged user with no plan', () => {
    setFlag(true, true)
    render(<CampaignPlanRouter initialUser={null} planExists={false} />)
    expect(generateButton()).toBeInTheDocument()
    expect(router.replace).not.toHaveBeenCalled()
  })

  it('renders the plan once the user requests generation', async () => {
    setFlag(true, true)
    render(<CampaignPlanRouter initialUser={null} planExists={false} />)
    await userEvent.click(screen.getByRole('button', { name: 'generate' }))
    expect(planPage()).toBeInTheDocument()
  })

  it('keeps showing the plan after navigating away mid-generation', async () => {
    setFlag(true, true)
    sessionStorage.setItem(
      'campaignPlanGenerateRequestedAt',
      String(Date.now()),
    )
    render(<CampaignPlanRouter initialUser={null} planExists={false} />)
    expect(await screen.findByTestId('plan-page')).toBeInTheDocument()
  })

  it('ignores a stale generate request and shows the gate', () => {
    setFlag(true, true)
    const sixteenMinutesAgo = Date.now() - 16 * 60 * 1000
    sessionStorage.setItem(
      'campaignPlanGenerateRequestedAt',
      String(sixteenMinutesAgo),
    )
    render(<CampaignPlanRouter initialUser={null} planExists={false} />)
    expect(generateButton()).toBeInTheDocument()
    expect(planPage()).not.toBeInTheDocument()
  })
})
