import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render } from 'helpers/test-utils/render'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import CampaignManagerTasks from './CampaignManagerTasks'

// The meet card no longer keys off chat history; keep the module stubbed so no
// child pulls the real query into jsdom.
vi.mock('../chief-of-staff/data/use-chat-history', () => ({
  useChatHistory: () => ({ data: [] }),
}))

// The story card gates on story completion; default to incomplete so it
// renders in these tests.
vi.mock('app/dashboard/campaign-story/useCampaignStoryComplete', () => ({
  useCampaignStoryComplete: vi.fn(() => ({
    isComplete: false,
    isLoading: false,
    isError: false,
  })),
}))

const meetButton = () =>
  screen.queryByRole('button', { name: /meet your campaign manager/i })

beforeEach(() => {
  window.localStorage.clear()
})

describe('CampaignManagerTasks', () => {
  it('shows the meet button (when showMeetCard) and fires the callback', async () => {
    const onMeet = vi.fn()

    const user = userEvent.setup()
    render(
      <CampaignManagerTasks
        showMeetCard
        onMeetManager={onMeet}
        onSkipMeet={vi.fn()}
        onPersonalize={vi.fn()}
        onGetOnBallot={vi.fn()}
      />,
    )
    await user.click(
      screen.getByRole('button', { name: /meet your campaign manager/i }),
    )

    expect(onMeet).toHaveBeenCalledOnce()
  })

  it('does not render the meet card when showMeetCard is false', () => {
    render(
      <CampaignManagerTasks
        showMeetCard={false}
        onMeetManager={vi.fn()}
        onSkipMeet={vi.fn()}
        onPersonalize={vi.fn()}
        onGetOnBallot={vi.fn()}
      />,
    )

    expect(meetButton()).not.toBeInTheDocument()
  })

  it('renders the personalize story card and wires its button', async () => {
    const onPersonalize = vi.fn()

    render(
      <CampaignManagerTasks
        showMeetCard
        onMeetManager={vi.fn()}
        onSkipMeet={vi.fn()}
        onPersonalize={onPersonalize}
        onGetOnBallot={vi.fn()}
      />,
    )
    await userEvent.click(
      screen.getByRole('button', { name: 'Personalize your campaign' }),
    )

    expect(onPersonalize).toHaveBeenCalledTimes(1)
  })
})
