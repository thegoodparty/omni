import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { render } from 'helpers/test-utils/render'
import { api } from 'helpers/test-utils/api-mocking'
import { EVENTS } from 'helpers/analyticsHelper'
import type { Priority } from '@goodparty_org/contracts'
import PrioritizeButton from './PrioritizeButton'

vi.mock('helpers/analyticsHelper', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('helpers/analyticsHelper')>()
  return { ...actual, trackEvent: vi.fn() }
})

const mockPriority: Priority = {
  id: 'p-1',
  electedOfficeId: 'office-1',
  title: 'Housing Crisis',
  description: 'Rising rents',
  source: 'community_issue',
  sourceCampaignPositionId: null,
  targetDate: null,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('<PrioritizeButton>', () => {
  it('calls the API on click then fires onPrioritized', async () => {
    api.mock('POST /v1/community-issues/:id/prioritize', {
      status: 200,
      data: mockPriority,
    })
    const user = userEvent.setup()
    const onPrioritized = vi.fn()

    render(<PrioritizeButton issueId="issue-1" onPrioritized={onPrioritized} />)

    await user.click(
      screen.getByRole('button', { name: /add to my priorities/i }),
    )

    await waitFor(() => expect(onPrioritized).toHaveBeenCalledTimes(1))
  })

  it('fires PrioritizeClicked event on click', async () => {
    api.mock('POST /v1/community-issues/:id/prioritize', {
      status: 200,
      data: mockPriority,
    })
    const user = userEvent.setup()
    const { trackEvent } = await import('helpers/analyticsHelper')

    render(<PrioritizeButton issueId="issue-1" onPrioritized={vi.fn()} />)

    await user.click(
      screen.getByRole('button', { name: /add to my priorities/i }),
    )

    expect(trackEvent).toHaveBeenCalledWith(
      EVENTS.CommunityIssues.PrioritizeClicked,
      { issueId: 'issue-1' },
    )
  })

  it('shows an error message when the request fails', async () => {
    api.mock('POST /v1/community-issues/:id/prioritize', {
      status: 500,
      data: { message: 'boom' },
    })
    const user = userEvent.setup()

    render(<PrioritizeButton issueId="issue-1" onPrioritized={vi.fn()} />)

    await user.click(
      screen.getByRole('button', { name: /add to my priorities/i }),
    )

    await waitFor(() =>
      expect(screen.getByText(/something went wrong/i)).toBeInTheDocument(),
    )
  })
})
