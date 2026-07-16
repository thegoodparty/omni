import { describe, it, expect, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import { render } from 'helpers/test-utils/render'
import { api } from 'helpers/test-utils/api-mocking'
import OnboardingCampaignStoryStep from './OnboardingCampaignStoryStep'

const { mockGetUserWebsite } = vi.hoisted(() => ({
  mockGetUserWebsite: vi.fn(),
}))

// Bio + issues come from the website via the legacy getUserWebsite (not a
// typed route), so mock the function directly, same as
// CampaignPlanStoryGate.test.tsx.
vi.mock('app/dashboard/website/util/website.util', async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import('app/dashboard/website/util/website.util')
    >()
  return { ...actual, getUserWebsite: mockGetUserWebsite }
})

// This component isn't wrapped in the real app's SnackbarProvider tree here;
// mock it down to no-ops, same as CampaignStoryPage.test.tsx.
vi.mock('helpers/useSnackbar', () => ({
  useSnackbar: () => ({ errorSnackbar: vi.fn(), successSnackbar: vi.fn() }),
}))

const website = {
  content: {
    about: {
      bio: '<p>My why is long enough</p>',
      issues: [{ title: 'Roads', description: 'Fix them' }],
    },
  },
}

describe('OnboardingCampaignStoryStep', () => {
  it('reports incomplete when the fetched story has no background', async () => {
    mockGetUserWebsite.mockResolvedValue(website)
    api.mock('GET /v1/campaigns/mine/story', {
      status: 200,
      data: { background: '' },
    })
    const onCompleteChange = vi.fn()
    render(<OnboardingCampaignStoryStep onCompleteChange={onCompleteChange} />)
    await waitFor(() =>
      expect(screen.getByText('Your background')).toBeInTheDocument(),
    )
    await waitFor(() =>
      expect(onCompleteChange).toHaveBeenLastCalledWith(false),
    )
  })

  it('reports complete when bio, background, and an issue are all present', async () => {
    mockGetUserWebsite.mockResolvedValue(website)
    api.mock('GET /v1/campaigns/mine/story', {
      status: 200,
      data: { background: 'I grew up here and ran a small business.' },
    })
    const onCompleteChange = vi.fn()
    render(<OnboardingCampaignStoryStep onCompleteChange={onCompleteChange} />)
    await waitFor(() => expect(onCompleteChange).toHaveBeenLastCalledWith(true))
  })

  it('reports incomplete while the website/story fetches are still pending', async () => {
    mockGetUserWebsite.mockImplementation(() => new Promise(() => undefined))
    api.mock('GET /v1/campaigns/mine/story', () => new Promise(() => undefined))
    const onCompleteChange = vi.fn()
    render(<OnboardingCampaignStoryStep onCompleteChange={onCompleteChange} />)

    await waitFor(() => expect(onCompleteChange).toHaveBeenCalledWith(false))
    expect(onCompleteChange).not.toHaveBeenCalledWith(true)
  })

  it("renders a returning candidate's fetched background into the card instead of an empty field", async () => {
    mockGetUserWebsite.mockResolvedValue(website)
    const background = 'I grew up here and ran a small business.'
    api.mock('GET /v1/campaigns/mine/story', {
      status: 200,
      data: { background },
    })
    const onCompleteChange = vi.fn()
    render(<OnboardingCampaignStoryStep onCompleteChange={onCompleteChange} />)

    // The background card must show the previously-saved text, not an empty
    // textarea, proves the card mounted after the fetch resolved rather than
    // seeding its useState(initialValue) from a pre-fetch empty default.
    await waitFor(() =>
      expect(screen.getByDisplayValue(background)).toBeInTheDocument(),
    )
    await waitFor(() => expect(onCompleteChange).toHaveBeenLastCalledWith(true))
  })
})
