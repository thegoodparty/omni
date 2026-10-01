import { describe, expect, it, vi } from 'vitest'
import { render } from 'helpers/test-utils/render'
import { screen } from '@testing-library/react'
import CampaignPlanStoryCard from './CampaignPlanStoryCard'

vi.mock('app/dashboard/campaign-story/useCampaignStoryComplete', () => ({
  useCampaignStoryComplete: vi.fn(),
}))
import { useCampaignStoryComplete } from 'app/dashboard/campaign-story/useCampaignStoryComplete'
const mockHook = vi.mocked(useCampaignStoryComplete)

const setStory = (isComplete: boolean, isLoading = false): void => {
  mockHook.mockReturnValue({ isComplete, isLoading, isError: false })
}

describe('CampaignPlanStoryCard', () => {
  it('prompts for the story while it is incomplete', () => {
    setStory(false)

    render(<CampaignPlanStoryCard />)

    expect(
      screen.getByRole('heading', { name: "Tell us why you're running" }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('link', { name: 'Add your story' }),
    ).toHaveAttribute('href', '/dashboard?personalize=1')
  })

  it('renders nothing once the story is complete', () => {
    setStory(true)

    render(<CampaignPlanStoryCard />)

    expect(
      screen.queryByRole('heading', { name: "Tell us why you're running" }),
    ).not.toBeInTheDocument()
  })

  // Otherwise it flashes in for a candidate whose story is already finished.
  it('renders nothing while the story state is still loading', () => {
    setStory(false, true)

    render(<CampaignPlanStoryCard />)

    expect(
      screen.queryByRole('heading', { name: "Tell us why you're running" }),
    ).not.toBeInTheDocument()
  })

  // Deliberately not dismissible: a generic plan is the symptom, the story is
  // the fix, so this is the one card on the page with no skip.
  it('offers no way to dismiss it', () => {
    setStory(false)

    render(<CampaignPlanStoryCard />)

    expect(
      screen.queryByRole('button', { name: /skip|dismiss/i }),
    ).not.toBeInTheDocument()
  })
})
