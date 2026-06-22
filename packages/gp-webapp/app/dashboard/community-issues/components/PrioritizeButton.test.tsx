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
  it('renders "Added to priorities" immediately when already prioritized without calling the API', () => {
    render(<PrioritizeButton issueId="issue-1" initialPrioritized={true} />)

    expect(screen.getByText('Added to priorities')).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: /add to my priorities/i }),
    ).not.toBeInTheDocument()
  })

  it('calls the API on click then renders "Added to priorities"', async () => {
    api.mock('POST /v1/community-issues/:id/prioritize', {
      status: 200,
      data: mockPriority,
    })
    const user = userEvent.setup()

    render(<PrioritizeButton issueId="issue-1" initialPrioritized={false} />)

    await user.click(
      screen.getByRole('button', { name: /add to my priorities/i }),
    )

    await waitFor(() =>
      expect(screen.getByText('Added to priorities')).toBeInTheDocument(),
    )
    expect(
      screen.queryByRole('button', { name: /add to my priorities/i }),
    ).not.toBeInTheDocument()
  })

  it('fires PrioritizeClicked event on click', async () => {
    api.mock('POST /v1/community-issues/:id/prioritize', {
      status: 200,
      data: mockPriority,
    })
    const user = userEvent.setup()
    const { trackEvent } = await import('helpers/analyticsHelper')

    render(<PrioritizeButton issueId="issue-1" initialPrioritized={false} />)

    await user.click(
      screen.getByRole('button', { name: /add to my priorities/i }),
    )

    expect(trackEvent).toHaveBeenCalledWith(
      EVENTS.CommunityIssues.PrioritizeClicked,
      { issueId: 'issue-1' },
    )
  })
})
