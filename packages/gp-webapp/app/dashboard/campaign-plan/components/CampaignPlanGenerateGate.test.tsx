import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { render } from 'helpers/test-utils/render'
import { api } from 'helpers/test-utils/api-mocking'
import CampaignPlanGenerateGate from './CampaignPlanGenerateGate'

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
const websiteWhyNoIssues = {
  content: { about: { bio: '<p>why answer</p>' } },
}

const generateButton = (): Promise<HTMLElement> =>
  screen.findByRole('button', { name: /Generate my Campaign Plan/ })

beforeEach(() => {
  vi.clearAllMocks()
  mockGetUserWebsite.mockResolvedValue(null)
})

describe('CampaignPlanGenerateGate', () => {
  it('offers generation (not an endless spinner) when the story fetch fails', async () => {
    api.mock('GET /v1/campaigns/mine/story', {
      status: 500,
      data: incompleteStory,
    })

    render(<CampaignPlanGenerateGate onGenerate={vi.fn()} />)

    expect(await generateButton()).toBeInTheDocument()
  })

  it('offers generation when the story has no background', async () => {
    api.mock('GET /v1/campaigns/mine/story', {
      status: 200,
      data: incompleteStory,
    })
    mockGetUserWebsite.mockResolvedValue(websiteComplete)

    render(<CampaignPlanGenerateGate onGenerate={vi.fn()} />)

    expect(await generateButton()).toBeInTheDocument()
  })

  it('offers generation when there are no issues', async () => {
    api.mock('GET /v1/campaigns/mine/story', {
      status: 200,
      data: completeStory,
    })
    mockGetUserWebsite.mockResolvedValue(websiteWhyNoIssues)

    render(<CampaignPlanGenerateGate onGenerate={vi.fn()} />)

    expect(await generateButton()).toBeInTheDocument()
  })

  it('omits the review sections and invites the story when nothing is filled in', async () => {
    api.mock('GET /v1/campaigns/mine/story', {
      status: 200,
      data: incompleteStory,
    })
    mockGetUserWebsite.mockResolvedValue(null)

    render(<CampaignPlanGenerateGate onGenerate={vi.fn()} />)

    expect(await generateButton()).toBeInTheDocument()
    expect(screen.queryByText('Your why')).not.toBeInTheDocument()
    expect(screen.queryByText('Your background')).not.toBeInTheDocument()
    expect(screen.queryByText('Your issues')).not.toBeInTheDocument()
    expect(
      screen.getByRole('link', { name: 'Add your story' }),
    ).toHaveAttribute('href', '/dashboard?personalize=1')
  })

  it('reviews the answers (why + background + website issues) with an edit link when complete', async () => {
    api.mock('GET /v1/campaigns/mine/story', {
      status: 200,
      data: completeStory,
    })
    mockGetUserWebsite.mockResolvedValue(websiteComplete)

    render(<CampaignPlanGenerateGate onGenerate={vi.fn()} />)

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

    render(<CampaignPlanGenerateGate onGenerate={vi.fn()} />)

    expect(await screen.findByText('fund <$50M')).toBeInTheDocument()
  })

  it('fails open (no empty issues section) when the website read errors but the story is complete', async () => {
    api.mock('GET /v1/campaigns/mine/story', {
      status: 200,
      data: completeStory,
    })
    mockGetUserWebsite.mockRejectedValue(new Error('network error'))

    render(<CampaignPlanGenerateGate onGenerate={vi.fn()} />)

    expect(await generateButton()).toBeInTheDocument()
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

    render(<CampaignPlanGenerateGate onGenerate={onGenerate} />)

    await userEvent.click(await generateButton())
    // Modal is open; nothing generated until the user confirms.
    expect(onGenerate).not.toHaveBeenCalled()

    await userEvent.click(
      screen.getByRole('button', { name: 'Yes, generate my plan' }),
    )
    expect(onGenerate).toHaveBeenCalledTimes(1)
  })
})
