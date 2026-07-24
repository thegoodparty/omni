import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { http, HttpResponse } from 'msw'
import { api, mswServer } from 'helpers/test-utils/api-mocking'
import type { Campaign } from 'helpers/types'
import { useCampaignStoryFlag } from '@shared/experiments/campaignStoryFlag'
import { EVENTS } from 'helpers/analyticsHelper'
import * as landscapeModule from '../success/hooks/useStrategicLandscape'
import OnboardingFlow from './OnboardingFlow'
import { ONBOARDING_STEPS } from './onboardingConfig'
import {
  getNextOnboardingStep,
  getPreviousOnboardingStep,
  getVisibleOnboardingSteps,
  resolvePostPledgeRoute,
} from './onboardingHelpers'

const {
  mockGetUserWebsite,
  mockSaveAboutFields,
  mockTrackEvent,
  mockErrorSnackbar,
  mockUseDictationAppend,
} = vi.hoisted(() => ({
  mockGetUserWebsite: vi.fn(),
  mockSaveAboutFields: vi.fn(),
  mockTrackEvent: vi.fn(),
  mockErrorSnackbar: vi.fn(),
  mockUseDictationAppend: vi.fn(),
}))

// Mock dictation so a test can flip a story card into an active recording state
// without the getUserMedia/WebSocket pipeline. Default (set in beforeEach) is
// idle, matching real on-mount behavior so the other tests are unaffected.
const IDLE_DICTATION = {
  status: 'idle' as const,
  error: null,
  partialTranscript: '',
  active: false,
  busy: false,
  start: vi.fn(),
  stop: vi.fn(),
  toggle: vi.fn(),
}
vi.mock('app/dashboard/briefings/shared/useDictationAppend', () => ({
  useDictationAppend: (input: { analyticsLabel: string }) =>
    mockUseDictationAppend(input),
}))

// Bio + issues come from (and are saved to) the website via legacy functions
// (not typed routes), so mock them directly to seed the story draft and stub
// the deferred save without exercising the network layer. getUserWebsite feeds
// the draft's initial values; saveAboutFields is the persist target on the
// final story step.
vi.mock('app/dashboard/website/util/website.util', async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import('app/dashboard/website/util/website.util')
    >()
  return {
    ...actual,
    getUserWebsite: mockGetUserWebsite,
    saveAboutFields: mockSaveAboutFields,
  }
})

// Keeps the real EVENTS map but replaces trackEvent with a spy, so tests can
// assert on which analytics events fire (or don't) around the campaign-story
// completion/skip guard, without exercising the network layer.
vi.mock('helpers/analyticsHelper', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('helpers/analyticsHelper')>()
  return { ...actual, trackEvent: mockTrackEvent }
})

// The story step uses the app's SnackbarProvider (only for save errors), which
// isn't mounted in this test tree, so mock it down to no-ops.
vi.mock('helpers/useSnackbar', () => ({
  useSnackbar: () => ({
    errorSnackbar: mockErrorSnackbar,
    successSnackbar: vi.fn(),
  }),
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

// From the first story step (why), click Continue through background and issues
// to the pledge. The final Continue persists the draft; whether it fires
// generation depends on the draft's completeness (seeded from the mocks).
const continueThroughStorySteps = async (): Promise<void> => {
  // why -> background
  fireEvent.click(await screen.findByRole('button', { name: 'Continue' }))
  await screen.findByRole('heading', { level: 2, name: /your background/i })
  // background -> issues
  fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
  await screen.findByRole('button', { name: /add a policy priority/i })
  // issues -> pledge (persists the draft)
  fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
}

// Skip is now per-question: it advances one story step at a time (why ->
// background -> issues -> pledge), so a full skip clicks Skip on each step.
// Awaits the step in between since advancing is async + guarded by
// isAdvancingRef (a too-fast second click would be dropped).
const skipThroughStorySteps = async (): Promise<void> => {
  // why -> background
  fireEvent.click(await screen.findByRole('button', { name: 'Skip' }))
  await screen.findByRole('heading', { level: 2, name: /your background/i })
  // background -> issues
  fireEvent.click(screen.getByRole('button', { name: 'Skip' }))
  await screen.findByRole('button', { name: /add a policy priority/i })
  // issues -> pledge
  fireEvent.click(screen.getByRole('button', { name: 'Skip' }))
}

beforeEach(() => {
  // Flag resolved (ready) but story cohort off by default, so every existing
  // test keeps seeing the story step omitted while Continue stays enabled
  // (canContinue now gates on campaignStoryReady). Tests opt into the cohort
  // by calling setCampaignStoryFlag(true, true) themselves.
  setCampaignStoryFlag(true, false)
  mockTrackEvent.mockClear()
  // Reset call history + implementation so a prior test's calls/returns don't
  // leak (these vi.fn()s aren't restored by vi.restoreAllMocks). Empty story by
  // default; completion tests override with a seeded website.
  mockGetUserWebsite.mockReset().mockResolvedValue({ content: { about: {} } })
  mockSaveAboutFields.mockReset().mockResolvedValue(true)
  mockErrorSnackbar.mockClear()
  mockUseDictationAppend.mockReset().mockReturnValue(IDLE_DICTATION)
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

  it('routes through the three story steps and on to the pledge', () => {
    const structured = { officePath: 'structured' as const }
    expect(
      getNextOnboardingStep(ONBOARDING_STEPS, 'campaign-story-why', structured)
        ?.id,
    ).toBe('campaign-story-background')
    expect(
      getNextOnboardingStep(
        ONBOARDING_STEPS,
        'campaign-story-background',
        structured,
      )?.id,
    ).toBe('campaign-story-issues')
    expect(
      getNextOnboardingStep(
        ONBOARDING_STEPS,
        'campaign-story-issues',
        structured,
      )?.id,
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
    // Unlike its voter-demographics predecessor, the story steps have no
    // officePath-based shouldSkip, so they stay visible for manual users too.
    expect(visibleStepIds).toContain('campaign-story-why')
    expect(visibleStepIds).toContain('campaign-story-background')
    expect(visibleStepIds).toContain('campaign-story-issues')
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

    // path-to-victory is skipped for manual users, but the story steps are
    // not, so the last story step sits directly before the pledge, and the
    // first story step directly after manual-office-entry.
    expect(
      getPreviousOnboardingStep(ONBOARDING_STEPS, 'pledge', answers)?.id,
    ).toBe('campaign-story-issues')
    expect(
      getNextOnboardingStep(ONBOARDING_STEPS, 'manual-office-entry', answers)
        ?.id,
    ).toBe('campaign-story-why')
  })

  it('renders the first story step (why) when the flag is on and never the demographics step', async () => {
    setCampaignStoryFlag(true, true)
    mswServer.use(
      http.put('/api/v1/campaigns/mine', () => HttpResponse.json({ id: 1 })),
      http.patch('/api/v1/organizations/:slug', () => HttpResponse.json({})),
    )
    api.mock('GET /v1/campaigns/mine/story', {
      status: 200,
      data: { background: '' },
    })
    renderFlow({ campaign: { id: 1 } as Campaign })

    await advancePastManualOfficeEntry()

    // The story steps suppress the page h1; the card carries the question.
    expect(
      await screen.findByRole('heading', {
        level: 2,
        name: /why are you running/i,
      }),
    ).toBeInTheDocument()
    expect(
      screen.queryByText(/voter insights for your district/i),
    ).not.toBeInTheDocument()
  })

  it('omits the story steps when the flag is off', async () => {
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
        level: 2,
        name: /why are you running/i,
      }),
    ).not.toBeInTheDocument()
  })

  it('persists and fires plan generation once when continuing through a completed story', async () => {
    const prewarm = vi
      .spyOn(landscapeModule, 'prewarmStrategicLandscape')
      .mockResolvedValue()
    setCampaignStoryFlag(true, true)
    mswServer.use(
      http.put('/api/v1/campaigns/mine', () => HttpResponse.json({ id: 1 })),
      http.patch('/api/v1/organizations/:slug', () => HttpResponse.json({})),
    )
    // Returning candidate: the draft seeds complete from the website + story.
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
    let storyBody: { background?: string } | null = null
    api.mock('PUT /v1/campaigns/mine/story', async ({ body }) => {
      storyBody = body
      return { status: 200, data: { background: 'saved' } }
    })
    renderFlow({ campaign: { id: 1 } as Campaign })

    await advancePastManualOfficeEntry()
    await screen.findByRole('heading', {
      level: 2,
      name: /why are you running/i,
    })

    await continueThroughStorySteps()

    expect(
      await screen.findByText('Take our pledge to get your campaign plan'),
    ).toBeInTheDocument()
    // Deferred save fired on the final step: background via the story endpoint,
    // bio + issues via saveAboutFields.
    expect(storyBody).toEqual({
      background: 'I grew up here and ran a small business.',
    })
    expect(mockSaveAboutFields).toHaveBeenCalledWith(
      expect.objectContaining({
        issues: [{ title: 'Roads', description: 'Fix them' }],
      }),
    )
    expect(prewarm).toHaveBeenCalledTimes(1)
  })

  it('blocks Continue on the issues step until at least one policy exists', async () => {
    setCampaignStoryFlag(true, true)
    mswServer.use(
      http.put('/api/v1/campaigns/mine', () => HttpResponse.json({ id: 1 })),
      http.patch('/api/v1/organizations/:slug', () => HttpResponse.json({})),
    )
    // Why + background answered, but no issues yet.
    mockGetUserWebsite.mockResolvedValue({
      content: { about: { bio: '<p>My why</p>', issues: [] } },
    })
    api.mock('GET /v1/campaigns/mine/story', {
      status: 200,
      data: { background: 'My background' },
    })
    api.mock('PUT /v1/campaigns/mine/story', {
      status: 200,
      data: { background: 'saved' },
    })
    renderFlow({ campaign: { id: 1 } as Campaign })

    await advancePastManualOfficeEntry()
    await screen.findByRole('heading', {
      level: 1,
      name: /why are you running/i,
    })
    // why -> background -> issues. Await the background step between clicks:
    // handleStoryContinue is async (awaits the campaign PUT) and guarded by
    // isAdvancingRef, so a second click before the first settles is a no-op.
    fireEvent.click(await screen.findByRole('button', { name: 'Continue' }))
    await screen.findByRole('heading', { level: 2, name: /your background/i })
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
    await screen.findByRole('button', { name: /add a policy priority/i })

    // No policy added yet → Continue is blocked (Skip is still the way out).
    expect(screen.getByRole('button', { name: 'Continue' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Skip' })).toBeEnabled()

    // Add a policy → Continue unlocks.
    fireEvent.click(
      screen.getByRole('button', { name: /add a policy priority/i }),
    )
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Continue' })).toBeEnabled(),
    )
  })

  it('blocks Continue on the issues step while a policy row is mid-dictation', async () => {
    setCampaignStoryFlag(true, true)
    mswServer.use(
      http.put('/api/v1/campaigns/mine', () => HttpResponse.json({ id: 1 })),
      http.patch('/api/v1/organizations/:slug', () => HttpResponse.json({})),
    )
    // Complete story so the length gate is satisfied; only dictation should
    // hold Continue.
    mockGetUserWebsite.mockResolvedValue({
      content: {
        about: {
          bio: '<p>My why</p>',
          issues: [{ title: 'Roads', description: 'Fix them' }],
        },
      },
    })
    api.mock('GET /v1/campaigns/mine/story', {
      status: 200,
      data: { background: 'My background' },
    })
    api.mock('PUT /v1/campaigns/mine/story', {
      status: 200,
      data: { background: 'saved' },
    })
    // Only the issue row is actively recording; why/background stay idle so the
    // earlier steps' Continue still advances.
    mockUseDictationAppend.mockImplementation(
      (input: { analyticsLabel: string }) =>
        input.analyticsLabel.startsWith('onboarding_story_issue')
          ? { ...IDLE_DICTATION, status: 'recording' as const, active: true }
          : IDLE_DICTATION,
    )
    renderFlow({ campaign: { id: 1 } as Campaign })

    await advancePastManualOfficeEntry()
    await screen.findByRole('heading', {
      level: 1,
      name: /why are you running/i,
    })
    // Await the background step between clicks (see the note above — the
    // async, isAdvancingRef-guarded Continue makes back-to-back clicks flaky).
    fireEvent.click(await screen.findByRole('button', { name: 'Continue' }))
    await screen.findByRole('heading', { level: 2, name: /your background/i })
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
    await screen.findByRole('button', { name: /add a policy priority/i })

    // Issue present (length gate passes) but a row is recording → both Continue
    // and Skip are held until recording stops, so neither can advance while an
    // in-flight transcript is still landing.
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Continue' })).toBeDisabled(),
    )
    expect(screen.getByRole('button', { name: 'Skip' })).toBeDisabled()
  })

  it('shows an error and stays on the step when a field save fails on Continue', async () => {
    const prewarm = vi
      .spyOn(landscapeModule, 'prewarmStrategicLandscape')
      .mockResolvedValue()
    setCampaignStoryFlag(true, true)
    mswServer.use(
      http.put('/api/v1/campaigns/mine', () => HttpResponse.json({ id: 1 })),
      http.patch('/api/v1/organizations/:slug', () => HttpResponse.json({})),
    )
    mockGetUserWebsite.mockResolvedValue({
      content: { about: { bio: '<p>My why</p>', issues: [] } },
    })
    api.mock('GET /v1/campaigns/mine/story', {
      status: 200,
      data: { background: 'My background' },
    })
    // The why field's save (saveAboutFields) fails on Continue.
    mockSaveAboutFields.mockResolvedValue(false)
    renderFlow({ campaign: { id: 1 } as Campaign })

    await advancePastManualOfficeEntry()
    await screen.findByRole('heading', {
      level: 1,
      name: /why are you running/i,
    })

    // Continue on the why step persists that field; the failed save surfaces an
    // error and holds the candidate on the why step (no advance to background).
    fireEvent.click(await screen.findByRole('button', { name: 'Continue' }))

    await waitFor(() => expect(mockErrorSnackbar).toHaveBeenCalled())
    expect(
      screen.queryByRole('heading', { level: 2, name: /your background/i }),
    ).not.toBeInTheDocument()
    expect(
      screen.getByRole('heading', { level: 1, name: /why are you running/i }),
    ).toBeInTheDocument()
    expect(prewarm).not.toHaveBeenCalled()
  })

  it('does not fire generation when skipping the story', async () => {
    const prewarm = vi
      .spyOn(landscapeModule, 'prewarmStrategicLandscape')
      .mockResolvedValue()
    setCampaignStoryFlag(true, true)
    mswServer.use(
      http.put('/api/v1/campaigns/mine', () => HttpResponse.json({ id: 1 })),
      http.patch('/api/v1/organizations/:slug', () => HttpResponse.json({})),
    )
    api.mock('GET /v1/campaigns/mine/story', {
      status: 200,
      data: { background: '' },
    })
    renderFlow({ campaign: { id: 1 } as Campaign })

    await advancePastManualOfficeEntry()
    await skipThroughStorySteps()

    expect(
      await screen.findByText('Take our pledge to get your campaign plan'),
    ).toBeInTheDocument()
    expect(prewarm).not.toHaveBeenCalled()
    // Nothing was answered, so persist writes nothing.
    expect(mockSaveAboutFields).not.toHaveBeenCalled()
  })

  it('does not fire a stray Skipped event when going back and skipping after completion', async () => {
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
    api.mock('PUT /v1/campaigns/mine/story', {
      status: 200,
      data: { background: 'saved' },
    })
    renderFlow({ campaign: { id: 1 } as Campaign })

    await advancePastManualOfficeEntry()
    await screen.findByRole('heading', {
      level: 2,
      name: /why are you running/i,
    })

    await continueThroughStorySteps()

    expect(
      await screen.findByText('Take our pledge to get your campaign plan'),
    ).toBeInTheDocument()
    expect(prewarm).toHaveBeenCalledTimes(1)
    expect(mockTrackEvent).toHaveBeenCalledWith(
      EVENTS.OnboardingV2.CampaignStoryCompleted,
      expect.anything(),
    )
    mockTrackEvent.mockClear()

    // Back to the last story step (issues), then skip. The in-memory draft is
    // still complete and generation already fired this session, so re-advancing
    // must not re-fire Completed or fire a stray Skipped.
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
    api.mock('GET /v1/campaigns/mine/story', {
      status: 200,
      data: { background: '' },
    })
    renderFlow({ campaign: { id: 1 } as Campaign })

    await advancePastManualOfficeEntry()
    await skipThroughStorySteps()

    expect(
      await screen.findByText('Take our pledge to get your campaign plan'),
    ).toBeInTheDocument()

    // Back (nothing answered → returns to the why step), then skip through
    // again.
    fireEvent.click(screen.getByRole('button', { name: 'Back' }))
    await skipThroughStorySteps()

    expect(
      await screen.findByText('Take our pledge to get your campaign plan'),
    ).toBeInTheDocument()

    const skippedCalls = mockTrackEvent.mock.calls.filter(
      ([event]) => event === EVENTS.OnboardingV2.CampaignStorySkipped,
    )
    expect(skippedCalls).toHaveLength(1)
  })

  it('returns from the pledge to the first unanswered story step, not the last one', async () => {
    setCampaignStoryFlag(true, true)
    mswServer.use(
      http.put('/api/v1/campaigns/mine', () => HttpResponse.json({ id: 1 })),
      http.patch('/api/v1/organizations/:slug', () => HttpResponse.json({})),
    )
    // Empty story, skipped from the first step.
    api.mock('GET /v1/campaigns/mine/story', {
      status: 200,
      data: { background: '' },
    })
    renderFlow({ campaign: { id: 1 } as Campaign })

    await advancePastManualOfficeEntry()
    await screen.findByRole('heading', {
      level: 2,
      name: /why are you running/i,
    })

    await skipThroughStorySteps()
    await screen.findByText('Take our pledge to get your campaign plan')

    // Back lands straight on the why step (first unanswered), not the issues
    // step (the literal previous step), and without stepping through each one.
    fireEvent.click(screen.getByRole('button', { name: 'Back' }))
    expect(
      await screen.findByRole('heading', {
        level: 2,
        name: /why are you running/i,
      }),
    ).toBeInTheDocument()
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

    // Skip through the (incomplete) story to the pledge.
    await skipThroughStorySteps()

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
    // Why + background answered (kept via Continue), but no issues yet — so the
    // first pass is incomplete. The candidate skips the issues step, then comes
    // back and adds a policy to complete it.
    mockGetUserWebsite.mockResolvedValue({
      content: { about: { bio: '<p>My why is long enough</p>', issues: [] } },
    })
    api.mock('GET /v1/campaigns/mine/story', {
      status: 200,
      data: { background: 'I grew up here and ran a small business.' },
    })
    api.mock('PUT /v1/campaigns/mine/story', {
      status: 200,
      data: { background: 'saved' },
    })
    renderFlow({ campaign: { id: 1 } as Campaign })

    await advancePastManualOfficeEntry()
    await screen.findByRole('heading', {
      level: 2,
      name: /why are you running/i,
    })

    // Continue keeps why + background; Skip the (empty) issues step.
    fireEvent.click(await screen.findByRole('button', { name: 'Continue' }))
    await screen.findByRole('heading', { level: 2, name: /your background/i })
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Skip' }))

    expect(
      await screen.findByText('Take our pledge to get your campaign plan'),
    ).toBeInTheDocument()
    expect(mockTrackEvent).toHaveBeenCalledWith(
      EVENTS.OnboardingV2.CampaignStorySkipped,
      expect.anything(),
    )
    expect(prewarm).not.toHaveBeenCalled()

    // Back returns to the issues step (why + background still answered), add a
    // policy to complete the story, then Continue.
    fireEvent.click(screen.getByRole('button', { name: 'Back' }))
    fireEvent.click(
      await screen.findByRole('button', { name: /add a policy priority/i }),
    )
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))

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

  it('does not fire generation when a returning candidate skips a fully-seeded story', async () => {
    const prewarm = vi
      .spyOn(landscapeModule, 'prewarmStrategicLandscape')
      .mockResolvedValue()
    setCampaignStoryFlag(true, true)
    mswServer.use(
      http.put('/api/v1/campaigns/mine', () => HttpResponse.json({ id: 1 })),
      http.patch('/api/v1/organizations/:slug', () => HttpResponse.json({})),
    )
    // Draft seeds COMPLETE from the DB (all three answered). Skipping every
    // question must not count as completion, so no generation / Completed.
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
    api.mock('PUT /v1/campaigns/mine/story', {
      status: 200,
      data: { background: 'saved' },
    })
    renderFlow({ campaign: { id: 1 } as Campaign })

    await advancePastManualOfficeEntry()
    await screen.findByRole('heading', {
      level: 2,
      name: /why are you running/i,
    })

    await skipThroughStorySteps()

    expect(
      await screen.findByText('Take our pledge to get your campaign plan'),
    ).toBeInTheDocument()
    expect(prewarm).not.toHaveBeenCalled()
    expect(mockTrackEvent).toHaveBeenCalledWith(
      EVENTS.OnboardingV2.CampaignStorySkipped,
      expect.anything(),
    )
    expect(mockTrackEvent).not.toHaveBeenCalledWith(
      EVENTS.OnboardingV2.CampaignStoryCompleted,
      expect.anything(),
    )
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
