import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { ReactNode } from 'react'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { render } from 'helpers/test-utils/render'
import { router } from 'helpers/test-utils/router-mocking'
import { useCampaignStoryFlag } from '@shared/experiments/campaignStoryFlag'
import CampaignPlanRouter from './CampaignPlanRouter'

vi.mock('@shared/experiments/campaignStoryFlag', () => ({
  useCampaignStoryFlag: vi.fn(),
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
const setFlag = (ready: boolean, enabled: boolean): void => {
  mockFlag.mockReturnValue({ ready, enabled })
}

const planPage = () => screen.queryByTestId('plan-page')
const generateButton = () => screen.queryByRole('button', { name: 'generate' })

describe('CampaignPlanRouter', () => {
  beforeEach(() => {
    router.replace?.mockClear()
    sessionStorage.clear()
    setFlag(true, true)
  })

  it('renders the plan immediately when one exists, ignoring the flag', () => {
    setFlag(false, false)
    render(<CampaignPlanRouter initialUser={null} planExists />)
    expect(planPage()).toBeInTheDocument()
  })

  it('shows a retry (never the regenerate gate) when existence is unknown', () => {
    setFlag(true, true)
    render(<CampaignPlanRouter initialUser={null} planExists={null} />)
    expect(
      screen.getByRole('button', { name: 'Try again' }),
    ).toBeInTheDocument()
    expect(generateButton()).not.toBeInTheDocument()
    expect(planPage()).not.toBeInTheDocument()
    expect(router.replace).not.toHaveBeenCalled()
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
