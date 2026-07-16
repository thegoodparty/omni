import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { http, HttpResponse } from 'msw'
import { mswServer } from 'helpers/test-utils/api-mocking'
import type { Campaign } from 'helpers/types'
import { useCampaignStoryFlag } from '@shared/experiments/campaignStoryFlag'
import OnboardingFlow from './OnboardingFlow'
import { ONBOARDING_STEPS } from './onboardingConfig'
import {
  getNextOnboardingStep,
  getPreviousOnboardingStep,
  getVisibleOnboardingSteps,
  resolvePostPledgeRoute,
} from './onboardingHelpers'

// Stubbed out so tests can drive the manual-office path with a couple of
// clicks instead of exercising the real search/geo UI (unrelated to what
// these tests cover — the flag-gated campaign-story step further down the
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
// whatever step comes next — campaign-story when the flag is on, pledge when
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
  // Matches the pre-mock default (no FeatureFlagsProvider in these tests, so
  // the context default resolves to ready:false/enabled:false) so every
  // existing test keeps seeing the flag off unless it opts in.
  setCampaignStoryFlag(false, false)
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

  it('routes structured users from voter-demographics straight to pledge', () => {
    expect(
      getNextOnboardingStep(ONBOARDING_STEPS, 'voter-demographics', {
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
    expect(visibleStepIds).not.toContain('voter-demographics')
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

    expect(
      getPreviousOnboardingStep(ONBOARDING_STEPS, 'pledge', answers)?.id,
    ).toBe('manual-office-entry')
    expect(
      getNextOnboardingStep(ONBOARDING_STEPS, 'manual-office-entry', answers)
        ?.id,
    ).toBe('pledge')
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
