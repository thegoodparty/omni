import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { render } from 'helpers/test-utils/render'
import { api } from 'helpers/test-utils/api-mocking'
import CampaignPlanStoryGate from './CampaignPlanStoryGate'

const { mockGetUserWebsite } = vi.hoisted(() => ({
  mockGetUserWebsite: vi.fn(),
}))

// Issues come from the website via the legacy getUserWebsite (not a typed
// route), so mock the function directly while keeping the rest of the module
// (USER_WEBSITE_QUERY_KEY) real.
vi.mock('app/dashboard/website/util/website.util', async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import('app/dashboard/website/util/website.util')
    >()
  return { ...actual, getUserWebsite: mockGetUserWebsite }
})

// Only `background` lives on the story now; the why is the website bio.
const completeStory = { background: 'background answer' }
const incompleteStory = { background: null }
// A complete website: a why (bio) and at least one issue.
const websiteComplete = {
  content: {
    about: {
      bio: '<p>why answer</p>',
      issues: [{ title: 'Roads', description: '<p>Fix the roads</p>' }],
    },
  },
}
// A why but no issues — the candidate still has to add issues.
const websiteWhyNoIssues = {
  content: { about: { bio: '<p>why answer</p>' } },
}

beforeEach(() => {
  vi.clearAllMocks()
  mockGetUserWebsite.mockResolvedValue(null)
})

describe('CampaignPlanStoryGate', () => {
  it('falls through to the complete-your-story prompt (not an endless spinner) when the fetch fails', async () => {
    api.mock('GET /v1/campaigns/mine/story', {
      status: 500,
      data: incompleteStory,
    })

    render(<CampaignPlanStoryGate onGenerate={vi.fn()} />)

    expect(
      await screen.findByRole('link', { name: 'Open your campaign manager' }),
    ).toBeInTheDocument()
  })

  it('prompts to complete the story when the background is incomplete', async () => {
    api.mock('GET /v1/campaigns/mine/story', {
      status: 200,
      data: incompleteStory,
    })
    mockGetUserWebsite.mockResolvedValue(websiteComplete)

    render(<CampaignPlanStoryGate onGenerate={vi.fn()} />)

    const link = await screen.findByRole('link', {
      name: 'Open your campaign manager',
    })
    expect(link).toHaveAttribute('href', '/dashboard?personalize=1')
    expect(
      screen.queryByRole('button', { name: /Generate my Campaign Plan/ }),
    ).not.toBeInTheDocument()
  })

  it('prompts to complete the story when there are no issues', async () => {
    api.mock('GET /v1/campaigns/mine/story', {
      status: 200,
      data: completeStory,
    })
    mockGetUserWebsite.mockResolvedValue(websiteWhyNoIssues)

    render(<CampaignPlanStoryGate onGenerate={vi.fn()} />)

    expect(
      await screen.findByRole('link', { name: 'Open your campaign manager' }),
    ).toBeInTheDocument()
  })

  it('reviews the answers (why + background + website issues) with an edit link when complete', async () => {
    api.mock('GET /v1/campaigns/mine/story', {
      status: 200,
      data: completeStory,
    })
    mockGetUserWebsite.mockResolvedValue(websiteComplete)

    render(<CampaignPlanStoryGate onGenerate={vi.fn()} />)

    expect(await screen.findByText('why answer')).toBeInTheDocument()
    expect(screen.getByText('background answer')).toBeInTheDocument()
    expect(screen.getByText('Roads')).toBeInTheDocument()
    expect(screen.getByText('Fix the roads')).toBeInTheDocument()
    expect(
      screen.getByRole('link', { name: 'Edit in campaign manager' }),
    ).toHaveAttribute('href', '/dashboard?personalize=1')
  })

  it('renders issue descriptions without dropping text after an HTML entity', async () => {
    api.mock('GET /v1/campaigns/mine/story', {
      status: 200,
      data: completeStory,
    })
    mockGetUserWebsite.mockResolvedValue({
      content: {
        about: {
          bio: '<p>why answer</p>',
          issues: [{ title: 'Budget', description: '<p>fund &lt;$50M</p>' }],
        },
      },
    })

    render(<CampaignPlanStoryGate onGenerate={vi.fn()} />)

    expect(await screen.findByText('fund <$50M')).toBeInTheDocument()
  })

  it('fails open (shows generate, no empty issues section) when the website read errors but the story is complete', async () => {
    api.mock('GET /v1/campaigns/mine/story', {
      status: 200,
      data: completeStory,
    })
    mockGetUserWebsite.mockRejectedValue(new Error('network error'))

    render(<CampaignPlanStoryGate onGenerate={vi.fn()} />)

    expect(
      await screen.findByRole('button', { name: /Generate my Campaign Plan/ }),
    ).toBeInTheDocument()
    // No issues to show, so the section is omitted rather than rendered empty.
    expect(screen.queryByText('Your issues')).not.toBeInTheDocument()
  })

  it('generates only after confirming in the modal', async () => {
    const onGenerate = vi.fn()
    api.mock('GET /v1/campaigns/mine/story', {
      status: 200,
      data: completeStory,
    })
    mockGetUserWebsite.mockResolvedValue(websiteComplete)

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
