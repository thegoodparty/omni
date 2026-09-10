import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render } from 'helpers/test-utils/render'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { CommunityIssueCard } from 'gpApi/api-endpoints'
import PriorityChoiceStep from './PriorityChoiceStep'

const issuesMock = vi.fn()
vi.mock('../data/use-community-issues', () => ({
  useTopCommunityIssues: () => issuesMock(),
}))

const prioritizeMock = vi.fn()
const createMock = vi.fn()
vi.mock('../data/use-priorities', () => ({
  usePrioritizeIssue: () => ({ mutate: prioritizeMock, isPending: false }),
  useCreatePriority: () => ({ mutate: createMock, isPending: false }),
}))

const issue = (over: Partial<CommunityIssueCard> = {}): CommunityIssueCard => ({
  id: 'issue_1',
  list: 'top_community',
  category: 'housing_and_development',
  priority: 'high',
  title: 'Short-term rentals are squeezing long-term housing',
  summary:
    'Residents report rents climbing as more units convert to nightly stays.',
  rank: 1,
  prioritized: false,
  ...over,
})

beforeEach(() => {
  prioritizeMock.mockReset()
  createMock.mockReset()
  issuesMock.mockReturnValue({
    data: [issue()],
    isPending: false,
    isError: false,
  })
})

describe('PriorityChoiceStep', () => {
  it('offers the surfaced issues as choices', async () => {
    render(<PriorityChoiceStep firstName="Renee" />)

    expect(
      await screen.findByText(/Hi Renee\. What are you working on right now\?/),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: /Short-term rentals are squeezing/ }),
    ).toBeInTheDocument()
    // The category rides along as the impact line, the way a due date does on
    // the task rail.
    expect(screen.getByText('Housing')).toBeInTheDocument()
  })

  it('commits a chosen issue as a priority', async () => {
    const user = userEvent.setup()
    render(<PriorityChoiceStep firstName="Renee" />)

    await user.click(
      await screen.findByRole('button', { name: /Short-term rentals/ }),
    )

    expect(prioritizeMock).toHaveBeenCalledWith('issue_1')
    expect(createMock).not.toHaveBeenCalled()
  })

  it('takes a written-in priority from the card at the bottom', async () => {
    const user = userEvent.setup()
    render(<PriorityChoiceStep firstName="Renee" />)

    await user.click(
      await screen.findByRole('button', { name: /It's something else/ }),
    )
    await user.type(
      screen.getByRole('textbox', {
        name: /Describe what you are working on/,
      }),
      'Getting a crosswalk at the elementary school',
    )
    await user.click(screen.getByRole('button', { name: 'Send' }))

    expect(createMock).toHaveBeenCalledWith(
      'Getting a crosswalk at the elementary school',
    )
    expect(prioritizeMock).not.toHaveBeenCalled()
  })

  it('submits a written-in priority on Enter', async () => {
    const user = userEvent.setup()
    render(<PriorityChoiceStep firstName="Renee" />)

    await user.click(
      await screen.findByRole('button', { name: /It's something else/ }),
    )
    await user.type(
      screen.getByRole('textbox', {
        name: /Describe what you are working on/,
      }),
      'Sidewalk repair on Main{Enter}',
    )

    expect(createMock).toHaveBeenCalledWith('Sidewalk repair on Main')
  })

  it('ignores an empty written-in answer', async () => {
    const user = userEvent.setup()
    render(<PriorityChoiceStep firstName="Renee" />)

    await user.click(
      await screen.findByRole('button', { name: /It's something else/ }),
    )
    expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled()
    await user.type(
      screen.getByRole('textbox', {
        name: /Describe what you are working on/,
      }),
      '   {Enter}',
    )

    expect(createMock).not.toHaveBeenCalled()
  })

  // The agent run that surfaces issues can still be generating for a fresh
  // org, so the question has to stand on its own without choices.
  it('still asks the question when no issues have surfaced yet', async () => {
    issuesMock.mockReturnValue({ data: [], isPending: false, isError: false })
    render(<PriorityChoiceStep firstName="Renee" />)

    expect(
      await screen.findByText(/Tell me the problem you want to solve/),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: /Tell me what you are working on/ }),
    ).toBeInTheDocument()
  })

  it('keeps the write-your-own path when the issue feed fails', async () => {
    issuesMock.mockReturnValue({
      data: undefined,
      isPending: false,
      isError: true,
    })
    render(<PriorityChoiceStep firstName="Renee" />)

    expect(
      await screen.findByText(/could not load what your district is talking/),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: /Tell me what you are working on/ }),
    ).toBeInTheDocument()
  })

  it('renders nothing while the issue feed is still loading', () => {
    issuesMock.mockReturnValue({
      data: undefined,
      isPending: true,
      isError: false,
    })
    const { container } = render(<PriorityChoiceStep firstName="Renee" />)

    expect(container).toBeEmptyDOMElement()
  })

  it('greets without a name when we do not have one', async () => {
    render(<PriorityChoiceStep />)

    await waitFor(() =>
      expect(
        screen.getByText(/^Hi\. What are you working on right now\?/),
      ).toBeInTheDocument(),
    )
  })
})
