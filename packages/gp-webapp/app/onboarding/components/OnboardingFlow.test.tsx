import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { http, HttpResponse } from 'msw'
import { api, mswServer } from 'helpers/test-utils/api-mocking'
import type { Campaign } from 'helpers/types'
import { useCampaignStoryFlag } from '@shared/experiments/campaignStoryFlag'
import { EVENTS } from 'helpers/analyticsHelper'
import { USER_WEBSITE_QUERY_KEY } from 'app/dashboard/website/util/website.util'
import * as landscapeModule from '../success/hooks/useStrategicLandscape'
import OnboardingFlow from './OnboardingFlow'
import { ONBOARDING_STEPS } from './onboardingConfig'
import {
  getNextOnboardingStep,
  getPreviousOnboardingStep,
  getVisibleOnboardingSteps,
  resolvePostPledgeRoute,
} from './onboardingHelpers'

const { mockGetUserWebsite, mockTrackEvent } = vi.hoisted(() => ({
  mockGetUserWebsite: vi.fn(),
  mockTrackEvent: vi.fn(),
}))

// Bio + issues come from the website via the legacy getUserWebsite (not a
// typed route), so mock the function directly (same as
// OnboardingCampaignStoryStep.test.tsx) to drive the real story step's
// completeness signal without exercising the network layer.
vi.mock('app/dashboard/website/util/website.util', async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import('app/dashboard/website/util/website.util')
    >()
  return { ...actual, getUserWebsite: mockGetUserWebsite }
})

// Keeps the real EVENTS map but replaces trackEvent with a spy, so tests can
// assert on which analytics events fire (or don't) around the campaign-story
// completion/skip guard, without exercising the network layer.
vi.mock('helpers/analyticsHelper', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('helpers/analyticsHelper')>()
  return { ...actual, trackEvent: mockTrackEvent }
})

// The campaign-story cards use the app's SnackbarProvider (only for save
// errors), which isn't mounted in this test tree, so mock it down to no-ops,
// same as OnboardingCampaignStoryStep.test.tsx.
vi.mock('helpers/useSnackbar', () => ({
  useSnackbar: () => ({ errorSnackbar: vi.fn(), successSnackbar: vi.fn() }),
}))

// Stubbed out so tests can drive the manual-office path with a couple of
// clicks instead of exercising the real search/geo UI (unrelated to what
// these tests cover - the flag-gated campaign-story step further down the
// flow).
vi.mock('./OfficeSelectionStep', () => ({
  OfficeSelectionStep: ({
    onCantFindOffice,
  }: {
    onCantFindOffice: () => void
  }) => (
    <button type="button" onClick={onCantFindOffice}>
      mock cant find office
    </button>
  ),
}))
vi.mock('./ManualOfficeEntryStep', () => ({
  ManualOfficeEntryStep: ({
    onChange,
  }: {
    onChange: (form: {
      office: string
      state: string
      city: string
      district: string
      officeTermLength: string
      electionDate: string
    }) => void
  }) => (
    <button
      type="button"
      onClick={() =>
        onChange({
          office: 'Mayor',
          state: 'CA',
          city: 'Springfield',
          district: '',
          officeTermLength: '4 years',
          electionDate: '2099-01-01',
        })
      }
    >
      mock fill manual office
    </button>
  ),
}))
vi.mock('@shared/experiments/campaignStoryFlag', () => ({
  useCampaignStoryFlag: vi.fn(),
}))

const mockCampaignStoryFlag = vi.mocked(useCampaignStoryFlag)
const setCampaignStoryFlag = (ready: boolean, enabled: boolean): void => {
  mockCampaignStoryFlag.mockReturnValue({ ready, enabled })
}

const renderFlow = (props: { campaign?: Campaign | null } = {}) =>
  render(
    <QueryClientProvider client={new QueryClient()}>
      <OnboardingFlow {...props} />
    </QueryClientProvider>,
  )

// Drives the flow from welcome through the manual-office-entry step (using
// the mocked office steps above) and clicks Continue once more, landing on
// whatever step comes next - campaign-story when the flag is on, pledge when
// it's off. Requires the caller to have mocked the PUT /campaigns/mine and
// PATCH /organizations/:slug endpoints the manual-office persist path hits.
const advancePastManualOfficeEntry = async (): Promise<void> => {
  const continueButton = screen.getByRole('button', { name: /continue/i })
  fireEvent.click(continueButton) // welcome -> ballot-status
  fireEvent.click(await screen.findByLabelText(/officially on the ballot/i))
  fireEvent.click(continueButton) // ballot-status -> party-affiliation
  fireEvent.click(await screen.findByLabelText(/nonpartisan race/i))
  fireEvent.click(continueButton) // party-affiliation -> office-selection
  fireEvent.click(
    await screen.findByRole('button', { name: /mock cant find office/i }),
  ) // office-selection -> manual-office-entry (jumps directly)
  fireEvent.click(
    await screen.findByRole('button', { name: /mock fill manual office/i }),
  )
  fireEvent.click(continueButton) // manual-office-entry -> next step
}

beforeEach(() => {
  // Flag resolved (ready) but story cohort off by default, so every existing
  // test keeps seeing the story step omitted while Continue stays enabled
  // (canContinue now gates on campaignStoryReady). Tests opt into the cohort
  // by calling setCampaignStoryFlag(true, true) themselves.
  setCampaignStoryFlag(true, false)
  mockTrackEvent.mockClear()
})

// vi.spyOn on an already-spied export returns the SAME mock instance rather
// than a fresh one, so a prior test's call history (and any mockImplementation
// override) otherwise leaks into the next spyOn(landscapeModule, ...) call.
// Restore after every test so each spyOn call starts from the real export.
afterEach(() => {
  vi.restoreAllMocks()
})

describe('new onboarding flow shell', () => {
  it('renders the first step on initial mount', () => {
    renderFlow()
    expect(
      screen.getByRole('heading', { level: 1, name: /winning campaign plan/i }),
    ).toBeInTheDocument()
    expect(screen.getByText(/Step 1 of/)).toBeInTheDocument()
  })

  it('routes structured office users through structured calculation steps', () => {
    expect(
      getNextOnboardingStep(ONBOARDING_STEPS, 'office-selection', {
        officePath: 'structured',
      })?.id,
    ).toBe('path-to-victory')
  })

  it('routes structured users from campaign-story straight to pledge', () => {
    expect(
      getNextOnboardingStep(ONBOARDING_STEPS, 'campaign-story', {
        officePath: 'structured',
      })?.id,
    ).toBe('pledge')
  })

  it('routes manual office users through manual entry and skips structured calculation steps', () => {
    const visibleStepIds = getVisibleOnboardingSteps(ONBOARDING_STEPS, {
      officePath: 'manual',
      manualOffice: true,
      unmatchedOffice: true,
    }).map((step) => step.id)

    expect(
      getNextOnboardingStep(ONBOARDING_STEPS, 'office-selection', {
        officePath: 'manual',
      })?.id,
    ).toBe('manual-office-entry')
    expect(visibleStepIds).toContain('manual-office-entry')
    expect(visibleStepIds).not.toContain('path-to-victory')
    // Unlike its voter-demographics predecessor, campaign-story has no
    // officePath-based shouldSkip, so it stays visible for manual users too.
    expect(visibleStepIds).toContain('campaign-story')
  })

  it('disables continue on the ballot-status step until a status is selected', async () => {
    renderFlow()

    const continueButton = screen.getByRole('button', { name: /continue/i })
    fireEvent.click(continueButton)

    expect(
      await screen.findByRole('heading', {
        level: 1,
        name: /already on the ballot/i,
      }),
    ).toBeInTheDocument()
    expect(continueButton).toBeDisabled()

    fireEvent.click(screen.getByLabelText(/officially on the ballot/i))
    expect(continueButton).toBeEnabled()

    fireEvent.click(continueButton)
    await waitFor(() =>
      expect(
        screen.queryByRole('heading', {
          level: 1,
          name: /already on the ballot/i,
        }),
      ).not.toBeInTheDocument(),
    )
  })

  it('blocks continue on party affiliation when a major party is selected', async () => {
    renderFlow()

    const continueButton = screen.getByRole('button', { name: /continue/i })
    // welcome -> ballot-status
    fireEvent.click(continueButton)
    fireEvent.click(await screen.findByLabelText(/officially on the ballot/i))
    // ballot-status -> party-affiliation
    fireEvent.click(continueButton)

    expect(
      await screen.findByRole('heading', {
        level: 1,
        name: /party designation/i,
      }),
    ).toBeInTheDocument()
    expect(continueButton).toBeDisabled()

    fireEvent.click(screen.getByLabelText(/democrat/i))
    expect(continueButton).toBeDisabled()
    expect(screen.getByRole('alert')).toHaveTextContent(
      /only for non-partisan and independent candidates/i,
    )

    fireEvent.click(screen.getByLabelText(/nonpartisan race/i))
    expect(continueButton).toBeEnabled()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('advances the step when the campaign persist succeeds', async () => {
    mswServer.use(
      http.put('/api/v1/campaigns/mine', () => HttpResponse.json({ id: 1 })),
    )
    renderFlow({ campaign: { id: 1 } as Campaign })

    fireEvent.click(screen.getByRole('button', { name: /continue/i }))

    expect(
      await screen.findByRole('heading', {
        level: 1,
        name: /already on the ballot/i,
      }),
    ).toBeInTheDocument()
  })

  it('does not advance the step when the campaign persist fails', async () => {
    mswServer.use(
      http.put('/api/v1/campaigns/mine', () =>
        HttpResponse.json({ message: 'bad' }, { status: 500 }),
      ),
    )
    renderFlow({ campaign: { id: 1 } as Campaign })

    fireEvent.click(screen.getByRole('button', { name: /continue/i }))

    await expect(
      screen.findByRole(
        'heading',
        { level: 1, name: /already on the ballot/i },
        { timeout: 300 },
      ),
    ).rejects.toThrow()
    expect(screen.getByText(/Step 1 of/)).toBeInTheDocument()
  })

  it('supports back and continue navigation across skipped manual-office steps', () => {
    const answers = {
      officePath: 'manual' as const,
      manualOffice: true,
      unmatchedOffice: true,
    }

    // path-to-victory is skipped for manual users, but campaign-story is
    // not, so it sits directly before pledge in both directions.
    expect(
      getPreviousOnboardingStep(ONBOARDING_STEPS, 'pledge', answers)?.id,
    ).toBe('campaign-story')
    expect(
      getNextOnboardingStep(ONBOARDING_STEPS, 'manual-office-entry', answers)
        ?.id,
    ).toBe('campaign-story')
  })

  it('renders the campaign-story step when the flag is on and never the demographics step', async () => {
    setCampaignStoryFlag(true, true)
    mswServer.use(
      http.put('/api/v1/campaigns/mine', () => HttpResponse.json({ id: 1 })),
      http.patch('/api/v1/organizations/:slug', () => HttpResponse.json({})),
    )
    renderFlow({ campaign: { id: 1 } as Campaign })

    await advancePastManualOfficeEntry()

    expect(
      await screen.findByRole('heading', {
        level: 1,
        name: /tell your campaign story/i,
      }),
    ).toBeInTheDocument()
    expect(
      screen.queryByText(/voter insights for your district/i),
    ).not.toBeInTheDocument()
  })

  it('omits the campaign-story step when the flag is off', async () => {
    setCampaignStoryFlag(true, false)
    mswServer.use(
      http.put('/api/v1/campaigns/mine', () => HttpResponse.json({ id: 1 })),
      http.patch('/api/v1/organizations/:slug', () => HttpResponse.json({})),
    )
    renderFlow({ campaign: { id: 1 } as Campaign })

    await advancePastManualOfficeEntry()

    expect(
      await screen.findByRole('heading', {
        level: 1,
        name: /take our pledge/i,
      }),
    ).toBeInTheDocument()
    expect(
      screen.queryByRole('heading', {
        level: 1,
        name: /tell your campaign story/i,
      }),
    ).not.toBeInTheDocument()
  })

  it('fires plan generation once when continuing a completed campaign-story step', async () => {
    const prewarm = vi
      .spyOn(landscapeModule, 'prewarmStrategicLandscape')
      .mockResolvedValue()
    setCampaignStoryFlag(true, true)
    mswServer.use(
      http.put('/api/v1/campaigns/mine', () => HttpResponse.json({ id: 1 })),
      http.patch('/api/v1/organizations/:slug', () => HttpResponse.json({})),
    )
    mockGetUserWebsite.mockResolvedValue({
      content: {
        about: {
          bio: '<p>My why is long enough</p>',
          issues: [{ title: 'Roads', description: 'Fix them' }],
        },
      },
    })
    api.mock('GET /v1/campaigns/mine/story', {
      status: 200,
      data: { background: 'I grew up here and ran a small business.' },
    })
    renderFlow({ campaign: { id: 1 } as Campaign })

    await advancePastManualOfficeEntry()

    expect(
      await screen.findByRole('heading', {
        level: 1,
        name: /tell your campaign story/i,
      }),
    ).toBeInTheDocument()

    // The footer label flips to "Continue" once the story cards report
    // complete (bio + background + an issue all present).
    const continueButton = await screen.findByRole('button', {
      name: 'Continue',
    })
    fireEvent.click(continueButton)

    expect(
      await screen.findByText('Take our pledge to get your campaign plan'),
    ).toBeInTheDocument()
    expect(prewarm).toHaveBeenCalledTimes(1)
  })

  it('does not fire generation when skipping an incomplete campaign-story step', async () => {
    const prewarm = vi
      .spyOn(landscapeModule, 'prewarmStrategicLandscape')
      .mockResolvedValue()
    setCampaignStoryFlag(true, true)
    mswServer.use(
      http.put('/api/v1/campaigns/mine', () => HttpResponse.json({ id: 1 })),
      http.patch('/api/v1/organizations/:slug', () => HttpResponse.json({})),
    )
    mockGetUserWebsite.mockResolvedValue({
      content: { about: { bio: '', issues: [] } },
    })
    api.mock('GET /v1/campaigns/mine/story', {
      status: 200,
      data: { background: '' },
    })
    renderFlow({ campaign: { id: 1 } as Campaign })

    await advancePastManualOfficeEntry()

    expect(
      await screen.findByRole('heading', {
        level: 1,
        name: /tell your campaign story/i,
      }),
    ).toBeInTheDocument()

    const skipButton = await screen.findByRole('button', {
      name: 'Skip',
    })
    fireEvent.click(skipButton)

    expect(
      await screen.findByText('Take our pledge to get your campaign plan'),
    ).toBeInTheDocument()
    expect(prewarm).not.toHaveBeenCalled()
  })

  it('does not fire a stray Skipped event on re-advance after completion', async () => {
    const prewarm = vi
      .spyOn(landscapeModule, 'prewarmStrategicLandscape')
      .mockResolvedValue()
    setCampaignStoryFlag(true, true)
    mswServer.use(
      http.put('/api/v1/campaigns/mine', () => HttpResponse.json({ id: 1 })),
      http.patch('/api/v1/organizations/:slug', () => HttpResponse.json({})),
    )
    mockGetUserWebsite.mockResolvedValue({
      content: {
        about: {
          bio: '<p>My why is long enough</p>',
          issues: [{ title: 'Roads', description: 'Fix them' }],
        },
      },
    })
    api.mock('GET /v1/campaigns/mine/story', {
      status: 200,
      data: { background: 'I grew up here and ran a small business.' },
    })
    // A dedicated client (renderFlow's is private to the helper) so the test
    // can drop the cached website fetch below, forcing the re-entered story
    // step through a real loading window instead of reusing stale cache.
    const queryClient = new QueryClient()
    render(
      <QueryClientProvider client={queryClient}>
        <OnboardingFlow campaign={{ id: 1 } as Campaign} />
      </QueryClientProvider>,
    )

    await advancePastManualOfficeEntry()

    expect(
      await screen.findByRole('heading', {
        level: 1,
        name: /tell your campaign story/i,
      }),
    ).toBeInTheDocument()

    fireEvent.click(await screen.findByRole('button', { name: 'Continue' }))

    expect(
      await screen.findByText('Take our pledge to get your campaign plan'),
    ).toBeInTheDocument()
    expect(prewarm).toHaveBeenCalledTimes(1)
    expect(mockTrackEvent).toHaveBeenCalledWith(
      EVENTS.OnboardingV2.CampaignStoryCompleted,
      expect.anything(),
    )
    mockTrackEvent.mockClear()

    // Simulate re-entering the story step mid-refetch: drop the cached
    // website fetch and swap in an incomplete response, so the remounted
    // step transiently (then persistently) reports storyComplete === false,
    // same as a user navigating back and forward before the story loads.
    // Generation already fired this session, so re-advancing must not
    // re-fire Completed or fire a stray Skipped.
    mockGetUserWebsite.mockResolvedValue({
      content: { about: { bio: '', issues: [] } },
    })
    queryClient.removeQueries({ queryKey: USER_WEBSITE_QUERY_KEY })
    fireEvent.click(screen.getByRole('button', { name: 'Back' }))

    const skipButton = await screen.findByRole('button', {
      name: 'Skip',
    })
    fireEvent.click(skipButton)

    expect(
      await screen.findByText('Take our pledge to get your campaign plan'),
    ).toBeInTheDocument()
    expect(prewarm).toHaveBeenCalledTimes(1)
    expect(mockTrackEvent).not.toHaveBeenCalledWith(
      EVENTS.OnboardingV2.CampaignStorySkipped,
      expect.anything(),
    )
    expect(mockTrackEvent).not.toHaveBeenCalledWith(
      EVENTS.OnboardingV2.CampaignStoryCompleted,
      expect.anything(),
    )
  })

  it('fires CampaignStorySkipped only once across skip, back, and skip again', async () => {
    setCampaignStoryFlag(true, true)
    mswServer.use(
      http.put('/api/v1/campaigns/mine', () => HttpResponse.json({ id: 1 })),
      http.patch('/api/v1/organizations/:slug', () => HttpResponse.json({})),
    )
    mockGetUserWebsite.mockResolvedValue({
      content: { about: { bio: '', issues: [] } },
    })
    api.mock('GET /v1/campaigns/mine/story', {
      status: 200,
      data: { background: '' },
    })
    renderFlow({ campaign: { id: 1 } as Campaign })

    await advancePastManualOfficeEntry()

    expect(
      await screen.findByRole('heading', {
        level: 1,
        name: /tell your campaign story/i,
      }),
    ).toBeInTheDocument()

    fireEvent.click(await screen.findByRole('button', { name: 'Skip' }))

    expect(
      await screen.findByText('Take our pledge to get your campaign plan'),
    ).toBeInTheDocument()

    // Back to the (still-incomplete) story step, then skip a second time.
    fireEvent.click(screen.getByRole('button', { name: 'Back' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Skip' }))

    expect(
      await screen.findByText('Take our pledge to get your campaign plan'),
    ).toBeInTheDocument()

    const skippedCalls = mockTrackEvent.mock.calls.filter(
      ([event]) => event === EVENTS.OnboardingV2.CampaignStorySkipped,
    )
    expect(skippedCalls).toHaveLength(1)
  })

  it('labels the pledge button "Meet your campaign manager" for the campaign-story cohort', async () => {
    setCampaignStoryFlag(true, true)
    mswServer.use(
      http.put('/api/v1/campaigns/mine', () => HttpResponse.json({ id: 1 })),
      http.patch('/api/v1/organizations/:slug', () => HttpResponse.json({})),
    )
    mockGetUserWebsite.mockResolvedValue({
      content: { about: { bio: '', issues: [] } },
    })
    api.mock('GET /v1/campaigns/mine/story', {
      status: 200,
      data: { background: '' },
    })
    renderFlow({ campaign: { id: 1 } as Campaign })

    await advancePastManualOfficeEntry()

    // On the (incomplete) story step, skip to the pledge.
    fireEvent.click(await screen.findByRole('button', { name: 'Skip' }))

    expect(
      await screen.findByText('Take our pledge to get your campaign plan'),
    ).toBeInTheDocument()
    // Story comes before the pledge and submit routes into the Campaign
    // Manager, so the pledge CTA is labeled to match that destination.
    expect(
      screen.getByRole('button', { name: 'Meet your campaign manager' }),
    ).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Agree & Continue' }),
    ).not.toBeInTheDocument()
  })

  it('keeps the flag-off pledge label "Agree & Create My Plan"', async () => {
    setCampaignStoryFlag(true, false)
    mswServer.use(
      http.put('/api/v1/campaigns/mine', () => HttpResponse.json({ id: 1 })),
      http.patch('/api/v1/organizations/:slug', () => HttpResponse.json({})),
    )
    renderFlow({ campaign: { id: 1 } as Campaign })

    // Story step is omitted when the flag is off, so this lands on the pledge.
    await advancePastManualOfficeEntry()

    expect(
      await screen.findByText('Take our pledge to get your campaign plan'),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Agree & Create My Plan' }),
    ).toBeInTheDocument()
  })

  it('blocks Continue until the campaign-story flag is ready', () => {
    setCampaignStoryFlag(false, false)
    const { rerender } = renderFlow()

    // Flag not yet resolved: advancing could skip the story step, so hold.
    expect(screen.getByRole('button', { name: /continue/i })).toBeDisabled()

    setCampaignStoryFlag(true, false)
    rerender(
      <QueryClientProvider client={new QueryClient()}>
        <OnboardingFlow />
      </QueryClientProvider>,
    )

    expect(screen.getByRole('button', { name: /continue/i })).toBeEnabled()
  })

  it('fires CampaignStoryCompleted and generation once when a prior skip is followed by completion', async () => {
    const prewarm = vi
      .spyOn(landscapeModule, 'prewarmStrategicLandscape')
      .mockResolvedValue()
    setCampaignStoryFlag(true, true)
    mswServer.use(
      http.put('/api/v1/campaigns/mine', () => HttpResponse.json({ id: 1 })),
      http.patch('/api/v1/organizations/:slug', () => HttpResponse.json({})),
    )
    mockGetUserWebsite.mockResolvedValue({
      content: { about: { bio: '', issues: [] } },
    })
    api.mock('GET /v1/campaigns/mine/story', {
      status: 200,
      data: { background: 'I grew up here and ran a small business.' },
    })
    // A dedicated client (renderFlow's is private to the helper) so the test
    // can drop the cached website fetch below, forcing the re-entered story
    // step to pick up the now-complete bio/issues instead of reusing the
    // stale (incomplete) cache from the first visit.
    const queryClient = new QueryClient()
    render(
      <QueryClientProvider client={queryClient}>
        <OnboardingFlow campaign={{ id: 1 } as Campaign} />
      </QueryClientProvider>,
    )

    await advancePastManualOfficeEntry()

    expect(
      await screen.findByRole('heading', {
        level: 1,
        name: /tell your campaign story/i,
      }),
    ).toBeInTheDocument()

    fireEvent.click(await screen.findByRole('button', { name: 'Skip' }))

    expect(
      await screen.findByText('Take our pledge to get your campaign plan'),
    ).toBeInTheDocument()
    expect(mockTrackEvent).toHaveBeenCalledWith(
      EVENTS.OnboardingV2.CampaignStorySkipped,
      expect.anything(),
    )
    expect(prewarm).not.toHaveBeenCalled()

    // Back to the story step, now with a complete bio + issue, so the
    // candidate finishes their story after having skipped once before.
    mockGetUserWebsite.mockResolvedValue({
      content: {
        about: {
          bio: '<p>My why is long enough</p>',
          issues: [{ title: 'Roads', description: 'Fix them' }],
        },
      },
    })
    queryClient.removeQueries({ queryKey: USER_WEBSITE_QUERY_KEY })
    fireEvent.click(screen.getByRole('button', { name: 'Back' }))

    // Continue unlocks only once the re-fetched (now complete) story reports
    // done, so wait for it to enable before clicking.
    const continueButton = await screen.findByRole('button', {
      name: 'Continue',
    })
    await waitFor(() => expect(continueButton).toBeEnabled())
    fireEvent.click(continueButton)

    expect(
      await screen.findByText('Take our pledge to get your campaign plan'),
    ).toBeInTheDocument()
    expect(prewarm).toHaveBeenCalledTimes(1)

    const skippedCalls = mockTrackEvent.mock.calls.filter(
      ([event]) => event === EVENTS.OnboardingV2.CampaignStorySkipped,
    )
    const completedCalls = mockTrackEvent.mock.calls.filter(
      ([event]) => event === EVENTS.OnboardingV2.CampaignStoryCompleted,
    )
    expect(skippedCalls).toHaveLength(1)
    expect(completedCalls).toHaveLength(1)
  })
})

describe('resolvePostPledgeRoute', () => {
  it('sends campaign-story users to the Campaign Manager home (highest precedence)', () => {
    expect(
      resolvePostPledgeRoute({
        campaignStoryEnabled: true,
        campaignStrategyEnabled: true,
      }),
    ).toBe('/dashboard')
  })

  it('sends campaign-strategy-only (story-off) users to the legacy success page', () => {
    expect(
      resolvePostPledgeRoute({
        campaignStoryEnabled: false,
        campaignStrategyEnabled: true,
      }),
    ).toBe('/onboarding/success')
  })

  it('sends everyone else to the dashboard', () => {
    expect(
      resolvePostPledgeRoute({
        campaignStoryEnabled: false,
        campaignStrategyEnabled: false,
      }),
    ).toBe('/dashboard')
  })
})
