import { describe, expect, it, vi } from 'vitest'
import { render } from 'helpers/test-utils/render'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import PersonalizeStoryCard from './PersonalizeStoryCard'

vi.mock('app/dashboard/campaign-story/useCampaignStoryComplete', () => ({
  useCampaignStoryComplete: vi.fn(),
}))
import { useCampaignStoryComplete } from 'app/dashboard/campaign-story/useCampaignStoryComplete'
const mockHook = vi.mocked(useCampaignStoryComplete)

describe('PersonalizeStoryCard', () => {
  it('renders the story card while the story is incomplete', async () => {
    mockHook.mockReturnValue({
      isComplete: false,
      isLoading: false,
      isError: false,
    })
    const onPersonalize = vi.fn()
    const user = userEvent.setup()
    render(<PersonalizeStoryCard onPersonalize={onPersonalize} />)

    expect(
      screen.getByText('Personalize your campaign messaging'),
    ).toBeInTheDocument()
    await user.click(
      screen.getByRole('button', { name: 'Personalize your campaign' }),
    )
    expect(onPersonalize).toHaveBeenCalledTimes(1)
  })

  it('renders nothing once the story is complete', () => {
    mockHook.mockReturnValue({
      isComplete: true,
      isLoading: false,
      isError: false,
    })
    const { container } = render(
      <PersonalizeStoryCard onPersonalize={vi.fn()} />,
    )
    expect(container).toBeEmptyDOMElement()
  })

  it('renders nothing while the story state is loading', () => {
    mockHook.mockReturnValue({
      isComplete: false,
      isLoading: true,
      isError: false,
    })
    const { container } = render(
      <PersonalizeStoryCard onPersonalize={vi.fn()} />,
    )
    expect(container).toBeEmptyDOMElement()
  })
})
