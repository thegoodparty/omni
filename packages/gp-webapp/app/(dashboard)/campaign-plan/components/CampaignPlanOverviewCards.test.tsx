import { describe, expect, it, vi } from 'vitest'
import { render } from 'helpers/test-utils/render'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { EVENTS, trackEvent } from 'helpers/analyticsHelper'
import CampaignPlanOverviewCards from './CampaignPlanOverviewCards'

const mockStory = vi.hoisted(() => ({
  value: { isComplete: true, isLoading: false, isError: false },
}))

vi.mock('app/(dashboard)/campaign-story/useCampaignStoryComplete', () => ({
  useCampaignStoryComplete: () => mockStory.value,
}))
vi.mock('helpers/analyticsHelper', async (importOriginal) => ({
  ...(await importOriginal<typeof import('helpers/analyticsHelper')>()),
  trackEvent: vi.fn(),
}))

describe('CampaignPlanOverviewCards', () => {
  it('links each card to where it can be edited', () => {
    render(
      <CampaignPlanOverviewCards
        race="Palm Bay City Council"
        electionDate="Nov 3, 2026"
      />,
    )

    expect(screen.getByRole('link', { name: /Your race/ })).toHaveAttribute(
      'href',
      '/profile',
    )
    expect(screen.getByRole('link', { name: /Your story/ })).toHaveAttribute(
      'href',
      '/campaign-story',
    )
    expect(
      screen.getByRole('link', { name: /Your opponents/ }),
    ).toHaveAttribute('href', '/race-opponent')
    expect(
      screen.getByText('Palm Bay City Council · Election Day Nov 3, 2026'),
    ).toBeInTheDocument()
  })

  it('asks for the story only once it is known to be missing', () => {
    mockStory.value = { isComplete: false, isLoading: true, isError: false }
    const { rerender } = render(
      <CampaignPlanOverviewCards race="Mayor" electionDate="" />,
    )
    expect(screen.queryByText(/Add yours/)).not.toBeInTheDocument()

    mockStory.value = { isComplete: false, isLoading: false, isError: false }
    rerender(<CampaignPlanOverviewCards race="Mayor" electionDate="" />)
    expect(
      screen.getByText('Add yours to make this plan about you'),
    ).toBeInTheDocument()
  })

  it('records which card was opened', async () => {
    render(<CampaignPlanOverviewCards race="Mayor" electionDate="" />)

    await userEvent.click(screen.getByRole('link', { name: /Your opponents/ }))

    expect(trackEvent).toHaveBeenCalledWith(
      EVENTS.Dashboard.CampaignPlan.OverviewCardClicked,
      { card: 'opponents' },
    )
  })
})
