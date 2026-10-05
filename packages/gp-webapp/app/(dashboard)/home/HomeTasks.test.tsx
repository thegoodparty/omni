import { describe, expect, it, vi } from 'vitest'
import { render } from 'helpers/test-utils/render'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import HomeTasks from './HomeTasks'

// The next-thing card has its own tests; here it only has to be placed.
vi.mock('./NextThingCard', () => ({
  default: () => <div>next-thing-card</div>,
}))

// The story card gates on story completion; default to incomplete so it
// renders.
vi.mock('app/(dashboard)/campaign-story/useCampaignStoryComplete', () => ({
  useCampaignStoryComplete: vi.fn(() => ({
    isComplete: false,
    isLoading: false,
    isError: false,
  })),
}))

const renderHomeTasks = (
  overrides: Partial<React.ComponentProps<typeof HomeTasks>> = {},
) =>
  render(
    <HomeTasks
      showMeetCard
      onMeetManager={vi.fn()}
      onSkipMeet={vi.fn()}
      onPersonalize={vi.fn()}
      {...overrides}
    />,
  )

describe('HomeTasks', () => {
  it('shows the next thing to do', () => {
    renderHomeTasks()
    expect(screen.getByText('next-thing-card')).toBeInTheDocument()
  })

  it('shows the tour button (when showMeetCard) and fires the callback', async () => {
    const onMeet = vi.fn()
    renderHomeTasks({ onMeetManager: onMeet })

    await userEvent.click(
      screen.getByRole('button', { name: /start the tour/i }),
    )

    expect(onMeet).toHaveBeenCalledOnce()
  })

  it('does not render the tour card when showMeetCard is false', () => {
    renderHomeTasks({ showMeetCard: false })

    expect(
      screen.queryByRole('button', { name: /start the tour/i }),
    ).not.toBeInTheDocument()
    expect(screen.getByText('next-thing-card')).toBeInTheDocument()
  })

  it('renders the personalize story card and wires its button', async () => {
    const onPersonalize = vi.fn()
    renderHomeTasks({ onPersonalize })

    await userEvent.click(
      screen.getByRole('button', { name: 'Personalize your campaign' }),
    )

    expect(onPersonalize).toHaveBeenCalledTimes(1)
  })
})
