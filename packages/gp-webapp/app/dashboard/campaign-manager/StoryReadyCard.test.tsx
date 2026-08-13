import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render } from 'helpers/test-utils/render'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import StoryReadyCard from './StoryReadyCard'

vi.mock('app/dashboard/campaign-story/useCampaignStoryComplete', () => ({
  useCampaignStoryComplete: vi.fn(),
}))
import { useCampaignStoryComplete } from 'app/dashboard/campaign-story/useCampaignStoryComplete'
const mockHook = vi.mocked(useCampaignStoryComplete)

const mockPush = vi.fn()
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush }),
}))

const DISMISSED_KEY = 'campaign-manager-story-ready-dismissed'
const complete = { isComplete: true, isLoading: false, isError: false }

beforeEach(() => {
  window.localStorage.clear()
  mockPush.mockClear()
})

describe('StoryReadyCard', () => {
  it('renders the ready card when the story is complete and not dismissed', () => {
    mockHook.mockReturnValue(complete)
    render(<StoryReadyCard />)

    expect(
      screen.getByText('Your campaign tracker and plan are ready'),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Review your campaign tracker' }),
    ).toBeInTheDocument()
  })

  it('renders nothing while the story is incomplete', () => {
    mockHook.mockReturnValue({
      isComplete: false,
      isLoading: false,
      isError: false,
    })
    const { container } = render(<StoryReadyCard />)
    expect(container).toBeEmptyDOMElement()
  })

  it('renders nothing while the story state is loading', () => {
    mockHook.mockReturnValue({
      isComplete: false,
      isLoading: true,
      isError: false,
    })
    const { container } = render(<StoryReadyCard />)
    expect(container).toBeEmptyDOMElement()
  })

  it('routes to the campaign tracker and dismisses when the CTA is clicked', async () => {
    mockHook.mockReturnValue(complete)
    const user = userEvent.setup()
    render(<StoryReadyCard />)

    await user.click(
      screen.getByRole('button', { name: 'Review your campaign tracker' }),
    )

    expect(mockPush).toHaveBeenCalledWith('/dashboard/campaign-plan')
    // Dismissed in place (card gone) and persisted.
    await waitFor(() =>
      expect(
        screen.queryByText('Your campaign tracker and plan are ready'),
      ).not.toBeInTheDocument(),
    )
    expect(window.localStorage.getItem(DISMISSED_KEY)).toBe('1')
  })

  it('dismisses via the overflow "Skip" without routing', async () => {
    mockHook.mockReturnValue(complete)
    const user = userEvent.setup()
    render(<StoryReadyCard />)

    await user.click(screen.getByRole('button', { name: 'More options' }))
    await user.click(await screen.findByRole('menuitem', { name: 'Skip' }))

    await waitFor(() =>
      expect(
        screen.queryByText('Your campaign tracker and plan are ready'),
      ).not.toBeInTheDocument(),
    )
    expect(window.localStorage.getItem(DISMISSED_KEY)).toBe('1')
    expect(mockPush).not.toHaveBeenCalled()
  })

  it('stays dismissed on a later mount (persisted)', () => {
    window.localStorage.setItem(DISMISSED_KEY, '1')
    mockHook.mockReturnValue(complete)
    const { container } = render(<StoryReadyCard />)
    expect(container).toBeEmptyDOMElement()
  })
})
