import { describe, it, expect, vi } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { render } from 'helpers/test-utils/render'
import { api } from 'helpers/test-utils/api-mocking'
import CampaignPlanStoryGate from './CampaignPlanStoryGate'

const completeStory = {
  why: 'why answer',
  background: 'background answer',
  issues: 'issues answer',
}
const incompleteStory = { why: 'w', background: null, issues: null }

describe('CampaignPlanStoryGate', () => {
  it('falls through to the complete-your-story prompt (not an endless spinner) when the fetch fails', async () => {
    api.mock('GET /v1/campaigns/mine/story', {
      status: 500,
      data: incompleteStory,
    })

    render(<CampaignPlanStoryGate onGenerate={vi.fn()} />)

    expect(
      await screen.findByRole('link', { name: 'Go to Campaign Story' }),
    ).toBeInTheDocument()
  })

  it('prompts to complete the story when it is incomplete', async () => {
    api.mock('GET /v1/campaigns/mine/story', {
      status: 200,
      data: incompleteStory,
    })

    render(<CampaignPlanStoryGate onGenerate={vi.fn()} />)

    const link = await screen.findByRole('link', {
      name: 'Go to Campaign Story',
    })
    expect(link).toHaveAttribute('href', '/dashboard/campaign-story')
    expect(
      screen.queryByRole('button', { name: /Generate my Campaign Plan/ }),
    ).not.toBeInTheDocument()
  })

  it('reviews the answers with an edit link when the story is complete', async () => {
    api.mock('GET /v1/campaigns/mine/story', {
      status: 200,
      data: completeStory,
    })

    render(<CampaignPlanStoryGate onGenerate={vi.fn()} />)

    expect(await screen.findByText('why answer')).toBeInTheDocument()
    expect(screen.getByText('background answer')).toBeInTheDocument()
    expect(screen.getByText('issues answer')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Edit my Story' })).toHaveAttribute(
      'href',
      '/dashboard/campaign-story',
    )
  })

  it('generates only after confirming in the modal', async () => {
    const onGenerate = vi.fn()
    api.mock('GET /v1/campaigns/mine/story', {
      status: 200,
      data: completeStory,
    })

    render(<CampaignPlanStoryGate onGenerate={onGenerate} />)

    await userEvent.click(
      await screen.findByRole('button', { name: /Generate my Campaign Plan/ }),
    )
    // Modal is open; nothing generated until the user confirms.
    expect(onGenerate).not.toHaveBeenCalled()

    await userEvent.click(
      screen.getByRole('button', { name: 'Yes, generate my plan' }),
    )
    expect(onGenerate).toHaveBeenCalledTimes(1)
  })
})
