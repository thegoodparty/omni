import { describe, it, expect, vi } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { render } from 'helpers/test-utils/render'
import { api } from 'helpers/test-utils/api-mocking'
import CampaignPlanStoryGate from './CampaignPlanStoryGate'

const completeStory = { why: 'w', background: 'b', issues: 'i' }
const incompleteStory = { why: 'w', background: null, issues: null }

describe('CampaignPlanStoryGate', () => {
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
      screen.queryByRole('button', { name: /Generate my Plan/ }),
    ).not.toBeInTheDocument()
  })

  it('offers generate and update actions when the story is complete', async () => {
    const onGenerate = vi.fn()
    api.mock('GET /v1/campaigns/mine/story', {
      status: 200,
      data: completeStory,
    })

    render(<CampaignPlanStoryGate onGenerate={onGenerate} />)

    const generate = await screen.findByRole('button', {
      name: /Generate my Plan/,
    })
    await userEvent.click(generate)
    expect(onGenerate).toHaveBeenCalledTimes(1)

    expect(
      screen.getByRole('link', { name: /update the Story/ }),
    ).toHaveAttribute('href', '/dashboard/campaign-story')
  })
})
