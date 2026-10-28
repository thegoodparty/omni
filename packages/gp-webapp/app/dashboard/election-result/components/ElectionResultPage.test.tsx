import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, fireEvent, waitFor } from '@testing-library/react'
import { render, testQueryClient } from 'helpers/test-utils/render'
import { api } from 'helpers/test-utils/api-mocking'
import { router } from 'helpers/test-utils/router-mocking'
import ElectionResultPage, {
  servePartyFromCampaign,
} from './ElectionResultPage'
import { updateCampaign } from 'app/onboarding/shared/ajaxActions'

type MockCampaign = {
  id: number
  isPro?: boolean
  details: { electionDate: string; subscriptionId?: string; party?: string }
}

const {
  mockErrorSnackbar,
  mockIsImpersonating,
  mockDismissElectionResult,
  mockSnoozeElectionResult,
  mockCampaign,
} = vi.hoisted(() => ({
  mockErrorSnackbar: vi.fn(),
  mockIsImpersonating: vi.fn(() => false),
  mockDismissElectionResult: vi.fn(),
  mockSnoozeElectionResult: vi.fn(),
  mockCampaign: {
    current: { id: 1, details: { electionDate: '2025-05-20' } } as {
      id: number
      isPro?: boolean
      details: { electionDate: string; subscriptionId?: string; party?: string }
    },
  },
}))

vi.mock('app/onboarding/shared/ajaxActions', () => ({
  updateCampaign: vi.fn(),
}))

vi.mock('@shared/hooks/useCampaign', () => ({
  useCampaign: () => [mockCampaign.current],
}))

vi.mock('@shared/hooks/usePositionName', () => ({
  usePositionName: () => 'Mayor',
}))

vi.mock('@shared/hooks/useIsImpersonating', () => ({
  useIsImpersonating: () => mockIsImpersonating(),
}))

vi.mock('../dismissal', () => ({
  dismissElectionResult: mockDismissElectionResult,
  snoozeElectionResult: mockSnoozeElectionResult,
}))

vi.mock('@shared/hooks/CampaignProvider', () => ({
  CAMPAIGN_QUERY_KEY: ['campaign'],
}))

const mockSetSelectedSlug = vi.fn()
vi.mock('@shared/organization-picker', () => ({
  ORGANIZATIONS_QUERY_KEY: ['organizations'],
  useSetOrganizationSlug: () => mockSetSelectedSlug,
  useOrganization: () => null,
}))

vi.mock('helpers/useSnackbar', () => ({
  useSnackbar: () => ({ errorSnackbar: mockErrorSnackbar }),
}))

vi.mock('helpers/analyticsHelper', () => ({
  EVENTS: {
    Candidacy: {
      DidYouWinModalCompleted: 'did_you_win_completed',
      DidYouWinModalViewed: 'did_you_win_viewed',
    },
  },
  trackEvent: vi.fn(),
}))

const mockUpdateCampaign = vi.mocked(updateCampaign)

const electedOfficeOrg = {
  slug: 'eo-1',
  name: null,
  positionName: null,
  position: null,
  district: null,
  electedOfficeId: 'eo-1',
  campaignId: null,
  status: 'active' as const,
}

const eoFixture = {
  id: 'eo-1',
  swornInDate: null,
  electedDate: null,
  termStartDate: null,
  termEndDate: null,
  termLengthDays: null,
  isActive: false,
  party: 'independent',
  pledgedAt: null,
  onboardingCompletedAt: null,
  selfReported: false,
  onboardingStep: 'confirm',
  campaignId: 1,
}

const answerWon = (): void => {
  fireEvent.click(screen.getByRole('button', { name: 'I won' }))
}

const startServing = async (): Promise<void> => {
  answerWon()
  fireEvent.click(
    await screen.findByRole('button', { name: 'Start preparing to serve' }),
  )
}

const proCampaign = (party?: string): MockCampaign => ({
  id: 1,
  isPro: true,
  details: { electionDate: '2025-05-20', ...(party ? { party } : {}) },
})

describe('ElectionResultPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockIsImpersonating.mockReturnValue(false)
    mockCampaign.current = { id: 1, details: { electionDate: '2025-05-20' } }
  })

  it('surfaces the billing portal for a Pro campaign with an active subscription', () => {
    mockCampaign.current = {
      id: 1,
      isPro: true,
      details: { electionDate: '2025-05-20', subscriptionId: 'sub_123' },
    }

    render(<ElectionResultPage />)

    expect(
      screen.getByText(/Pro subscription is still active/i),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Manage subscription' }),
    ).toBeInTheDocument()
  })

  it('asks about the race by office and election day', () => {
    render(<ElectionResultPage />)

    expect(
      screen.getByRole('heading', { name: 'Did you win your race for Mayor?' }),
    ).toBeInTheDocument()
    expect(
      screen.getByText('Your election was on May 20. Tell us how it went.'),
    ).toBeInTheDocument()
  })

  it('hides the question for 3 days when results are not final', () => {
    render(<ElectionResultPage />)
    fireEvent.click(
      screen.getByRole('button', { name: "Results aren't final yet" }),
    )

    expect(mockSnoozeElectionResult).toHaveBeenCalledWith(1)
    expect(router.replace).toHaveBeenCalledWith('/dashboard')
    expect(mockUpdateCampaign).not.toHaveBeenCalled()
  })

  it('opens on the congratulations when the chat answered "I won"', async () => {
    mockCampaign.current = proCampaign()
    render(<ElectionResultPage startWithWin />)

    expect(
      await screen.findByRole('button', { name: 'Start preparing to serve' }),
    ).toBeInTheDocument()
    expect(mockUpdateCampaign).not.toHaveBeenCalled()
  })

  it('saves the win and congratulates a winner without Pro who answered in chat', async () => {
    mockUpdateCampaign.mockResolvedValue({ id: 1 } as never)
    render(<ElectionResultPage startWithWin />)

    expect(
      await screen.findByRole('heading', { name: 'Congratulations, you won.' }),
    ).toBeInTheDocument()
    expect(mockUpdateCampaign).toHaveBeenCalledWith([
      { key: 'details.wonGeneral', value: true },
    ])
  })

  it('shows no subscription alert for a non-Pro campaign', () => {
    render(<ElectionResultPage />)

    expect(screen.queryByText(/Pro subscription is still active/i)).toBeNull()
  })

  it('lets an impersonating admin dismiss the gate without saving a result', () => {
    mockIsImpersonating.mockReturnValue(true)

    render(<ElectionResultPage />)

    expect(screen.getByText(/Impersonation mode/i)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }))

    expect(mockDismissElectionResult).toHaveBeenCalled()
    expect(router.push).toHaveBeenCalledWith('/dashboard')
    expect(mockUpdateCampaign).not.toHaveBeenCalled()
  })

  it('saves the loss result and routes to the loss flow without creating an office', async () => {
    mockUpdateCampaign.mockResolvedValue({ id: 1 } as never)

    let electedOfficeCreated = false
    api.mock('POST /v1/elected-office', () => {
      electedOfficeCreated = true
      return { status: 200, data: eoFixture }
    })

    render(<ElectionResultPage />)
    fireEvent.click(
      screen.getByRole('button', { name: "I didn't win this time" }),
    )

    await waitFor(() => {
      expect(router.replace).toHaveBeenCalledWith(
        '/dashboard/election-result/loss',
      )
    })
    expect(mockUpdateCampaign).toHaveBeenCalledWith([
      { key: 'details.wonGeneral', value: false },
    ])
    expect(electedOfficeCreated).toBe(false)
  })

  it('saves only the result for a winner without Pro', async () => {
    mockUpdateCampaign.mockResolvedValue({ id: 1 } as never)
    let electedOfficeCreated = false
    api.mock('POST /v1/elected-office', () => {
      electedOfficeCreated = true
      return { status: 200, data: eoFixture }
    })

    render(<ElectionResultPage />)
    answerWon()

    expect(
      await screen.findByRole('heading', { name: 'Congratulations, you won.' }),
    ).toBeInTheDocument()
    expect(mockUpdateCampaign).toHaveBeenCalledWith([
      { key: 'details.wonGeneral', value: true },
    ])
    expect(electedOfficeCreated).toBe(false)
    expect(
      screen.getByRole('link', { name: /Join the community/ }),
    ).toHaveAttribute('href', 'https://community.goodparty.org')
    expect(
      screen.queryByRole('button', { name: 'Start preparing to serve' }),
    ).toBeNull()
    expect(document.querySelector('video')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Back to dashboard' }))
    expect(router.replace).toHaveBeenCalledWith('/dashboard')
  })

  it('congratulates a Pro winner before saving anything', async () => {
    mockCampaign.current = proCampaign()
    render(<ElectionResultPage />)
    answerWon()

    expect(
      await screen.findByRole('heading', { name: 'Congratulations, you won.' }),
    ).toBeInTheDocument()
    expect(screen.getByText('You represent all of your district')).toBeVisible()
    expect(
      screen.getByText(
        'Learn where residents stand on the issues you ran on before you take office.',
      ),
    ).toBeInTheDocument()
    expect(
      screen.queryByRole('link', { name: /Join the community/ }),
    ).toBeNull()
    expect(mockUpdateCampaign).not.toHaveBeenCalled()

    // One video per frame (landscape from md up, square below), never
    // playing on its own, each named and described for screen readers.
    const videos = document.querySelectorAll('video')
    expect(videos).toHaveLength(2)
    videos.forEach((video) => {
      expect(video).toHaveAttribute('controls')
      expect(video).toHaveAttribute('preload', 'metadata')
      expect(video).not.toHaveAttribute('autoplay')
      expect(video).toHaveAccessibleName('Who gets the mic, a 1 minute video')
      expect(video).toHaveAccessibleDescription(/You represent every resident/)
    })
    expect(
      [...videos].map((video) => video.querySelector('source')?.src),
    ).toEqual([
      expect.stringContaining('/videos/who-gets-the-mic-landscape.mp4'),
      expect.stringContaining('/videos/who-gets-the-mic-square.mp4'),
    ])
    // The page itself never names the civic panel; only the video does.
    const visibleText = document.body.textContent?.replace(
      document.getElementById('who-gets-the-mic-text')?.textContent ?? '',
      '',
    )
    expect(visibleText).not.toMatch(/civic panel/i)
  })

  it('creates an unfinished office for a Pro winner and hands off to Serve onboarding', async () => {
    mockCampaign.current = proCampaign('independent')
    mockUpdateCampaign.mockResolvedValue({ id: 1 } as never)

    let createBody: Record<string, unknown> | null = null
    let createOrgSlug: string | undefined
    api.mock('POST /v1/elected-office', ({ body, headers }) => {
      createBody = body as Record<string, unknown>
      createOrgSlug = headers['x-organization-slug']
      return { status: 200, data: eoFixture }
    })
    api.mock('GET /v1/organizations', {
      status: 200,
      data: { organizations: [electedOfficeOrg] },
    })

    const invalidate = vi.spyOn(testQueryClient, 'invalidateQueries')
    render(<ElectionResultPage />)
    await startServing()

    await waitFor(() => {
      expect(router.replace).toHaveBeenCalledWith('/serve/onboarding')
    })
    // The dashboard's unfinished-winner redirect reads this list.
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: ['elected-office', 'mine'],
    })
    // Onboarding's pledge finishes the office, so it starts with no completion
    // stamp and no guessed term, checkpointed on the prefilled confirm step.
    expect(createBody).toEqual({
      party: 'independent',
      onboardingStep: 'confirm',
    })
    expect(createOrgSlug).toBe('campaign-1')
    expect(mockUpdateCampaign).toHaveBeenCalledWith([
      { key: 'details.wonGeneral', value: true },
    ])
    expect(mockSetSelectedSlug).toHaveBeenCalledWith('eo-1')
  })

  it('does not mark the campaign won when office creation fails', async () => {
    mockCampaign.current = proCampaign()
    mockUpdateCampaign.mockResolvedValue({ id: 1 } as never)
    api.mock('POST /v1/elected-office', () => ({
      status: 500,
      data: { message: 'boom' },
    }))

    render(<ElectionResultPage />)
    await startServing()

    await waitFor(() => {
      expect(mockErrorSnackbar).toHaveBeenCalled()
    })
    expect(mockUpdateCampaign).not.toHaveBeenCalled()
    expect(router.replace).not.toHaveBeenCalled()
  })

  it('shows an error and does not navigate when saving the win fails after the office is created', async () => {
    mockCampaign.current = proCampaign()
    mockUpdateCampaign.mockResolvedValue(false)
    api.mock('POST /v1/elected-office', () => ({
      status: 200,
      data: eoFixture,
    }))

    render(<ElectionResultPage />)
    await startServing()

    await waitFor(() => {
      expect(mockErrorSnackbar).toHaveBeenCalled()
    })
    expect(router.replace).not.toHaveBeenCalled()
  })

  it('still hands off when the org refresh fails after the office is created', async () => {
    mockCampaign.current = proCampaign()
    mockUpdateCampaign.mockResolvedValue({ id: 1 } as never)
    api.mock('POST /v1/elected-office', () => ({
      status: 200,
      data: eoFixture,
    }))
    api.mock('GET /v1/organizations', {
      status: 500,
      data: { message: 'boom' },
    })

    render(<ElectionResultPage />)
    await startServing()

    await waitFor(() => {
      expect(router.replace).toHaveBeenCalledWith('/serve/onboarding')
    })
    expect(mockErrorSnackbar).not.toHaveBeenCalled()
  })
})

describe('servePartyFromCampaign', () => {
  it.each([
    ['independent', 'independent'],
    ['nonpartisan', 'nonpartisan'],
    ['Libertarian', 'independent'],
    ['democrat', undefined],
    ['republican', undefined],
    [undefined, undefined],
    ['', undefined],
  ])('maps %s to %s', (campaignParty, expected) => {
    expect(servePartyFromCampaign(campaignParty)).toBe(expected)
  })
})
