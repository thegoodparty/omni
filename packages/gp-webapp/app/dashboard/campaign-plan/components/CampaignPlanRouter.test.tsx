import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { ReactNode } from 'react'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { render } from 'helpers/test-utils/render'
import { useCampaignStoryComplete } from 'app/dashboard/campaign-story/useCampaignStoryComplete'
import CampaignPlanRouter from './CampaignPlanRouter'

vi.mock('app/dashboard/campaign-story/useCampaignStoryComplete', () => ({
  useCampaignStoryComplete: vi.fn(),
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

const mockStoryComplete = vi.mocked(useCampaignStoryComplete)
const setStoryComplete = (isComplete: boolean, isLoading = false): void => {
  mockStoryComplete.mockReturnValue({ isComplete, isLoading, isError: false })
}

const planPage = () => screen.queryByTestId('plan-page')
const generateButton = () => screen.queryByRole('button', { name: 'generate' })

describe('CampaignPlanRouter', () => {
  beforeEach(() => {
    sessionStorage.clear()
    setStoryComplete(true)
  })

  it('shows the story gate for a user with no plan', () => {
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

  it('routes a user with a plan but an incomplete story to the gate', () => {
    setStoryComplete(false)
    render(<CampaignPlanRouter initialUser={null} planExists />)
    expect(generateButton()).toBeInTheDocument()
    expect(planPage()).not.toBeInTheDocument()
  })

  // The core invariant: a generate request (set by the gate, persisted in
  // sessionStorage) must not bypass the story-completeness requirement. Drop the
  // `storyComplete &&` guard and this is the test that fails — render() flushes
  // the sessionStorage effect, so a broken guard would already show the plan.
  it('does not let a generate request bypass the incomplete-story gate', () => {
    setStoryComplete(false)
    sessionStorage.setItem(
      'campaignPlanGenerateRequestedAt',
      String(Date.now()),
    )
    render(<CampaignPlanRouter initialUser={null} planExists={false} />)
    expect(generateButton()).toBeInTheDocument()
    expect(planPage()).not.toBeInTheDocument()
  })

  it('shows the plan for a user with a plan and a complete story', () => {
    setStoryComplete(true)
    render(<CampaignPlanRouter initialUser={null} planExists />)
    expect(planPage()).toBeInTheDocument()
    expect(generateButton()).not.toBeInTheDocument()
  })

  it('shows a spinner (not the gate) while the story is still loading', () => {
    setStoryComplete(false, true)
    render(<CampaignPlanRouter initialUser={null} planExists />)
    expect(planPage()).not.toBeInTheDocument()
    expect(generateButton()).not.toBeInTheDocument()
  })
})
