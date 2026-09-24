import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { http, HttpResponse } from 'msw'
import { api, mswServer } from 'helpers/test-utils/api-mocking'
import type { Campaign } from 'helpers/types'
import { EVENTS } from 'helpers/analyticsHelper'
import OnboardingFlow from './OnboardingFlow'
import type { OfficePickerGiveUpContext } from './onboardingTypes'

// PathToVictoryStep reads the org's resolved district so it can skip a stats
// fetch that could only 400. useOrganization throws outside its provider, and
// these flow tests render without the root layout that supplies it.
vi.mock('@shared/organization-picker', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@shared/organization-picker')>()),
  useOrganization: () => ({
    slug: 'campaign-1',
    positionName: 'Mayor',
    district: { id: 'd1', l2Type: 'City', l2Name: 'Austin' },
  }),
}))

const { mockGetUserWebsite, mockSaveAboutFields, mockTrackEvent } = vi.hoisted(
  () => ({
    mockGetUserWebsite: vi.fn(),
    mockSaveAboutFields: vi.fn(),
    mockTrackEvent: vi.fn(),
  }),
)

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

// Keeps the real EVENTS map but spies trackEvent, so the Completed / Skipped
// events and their properties can be asserted without the network layer.
vi.mock('helpers/analyticsHelper', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('helpers/analyticsHelper')>()
  return { ...actual, trackEvent: mockTrackEvent }
})

vi.mock('helpers/useSnackbar', () => ({
  useSnackbar: () => ({ errorSnackbar: vi.fn(), successSnackbar: vi.fn() }),
}))

// The per-step `Viewed` events attach the user's email directly and so are
// gated on a resolved user. These tests render without the UserProvider that
// would supply one, so stub the hook — and stub identifyUser with it, since a
// present user also turns on the trait writes.
vi.mock('@shared/hooks/useUser', () => ({
  useUser: () => [{ id: 7, email: 'candidate@example.com' }],
}))
vi.mock('@shared/utils/analytics', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@shared/utils/analytics')>()),
  identifyUser: vi.fn().mockResolvedValue(undefined),
}))

// Stubbed so the tests reach signup-goal with a couple of clicks instead of
// exercising the real search/geo UI.
vi.mock('./OfficeSelectionStep', () => ({
  OfficeSelectionStep: ({
    onCantFindOffice,
  }: {
    onCantFindOffice: (context: OfficePickerGiveUpContext) => void
  }) => (
    // Passes a context object like the real picker; wiring the handler
    // straight to onClick would hand the flow a React synthetic event.
    <button
      type="button"
      onClick={() =>
        onCantFindOffice({
          officeZip: '78701',
          searchQuery: '',
          categoryFilter: '',
          totalOffices: 0,
          filteredCount: 0,
          searchErrored: false,
        })
      }
    >
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
      level: string
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
          level: 'LOCAL',
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

const renderFlow = () =>
  render(
    <QueryClientProvider client={new QueryClient()}>
      <OnboardingFlow campaign={{ id: 1 } as Campaign} />
    </QueryClientProvider>,
  )

// Every PUT /campaigns/mine body, so a test can assert what the step wrote (or
// that it wrote nothing) without caring about the navigation-only writes the
// flow makes on each advance.
let putBodies: Array<Record<string, unknown>> = []

// Drives welcome -> ... -> manual-office-entry, then skips all three story
// steps, landing on signup-goal (the story block's successor).
const advanceToSignupGoal = async (): Promise<void> => {
  const continueButton = screen.getByRole('button', { name: /continue/i })
  fireEvent.click(continueButton) // welcome -> ballot-status
  fireEvent.click(await screen.findByLabelText(/officially on the ballot/i))
  fireEvent.click(continueButton) // ballot-status -> party-affiliation
  fireEvent.click(await screen.findByLabelText(/nonpartisan race/i))
  fireEvent.click(continueButton) // party-affiliation -> office-selection
  fireEvent.click(
    await screen.findByRole('button', { name: /mock cant find office/i }),
  )
  fireEvent.click(
    await screen.findByRole('button', { name: /mock fill manual office/i }),
  )
  fireEvent.click(continueButton) // manual-office-entry -> campaign-story-why

  // why -> background -> issues -> signup-goal
  fireEvent.click(await screen.findByRole('button', { name: 'Skip' }))
  await screen.findByRole('heading', { level: 2, name: /your background/i })
  fireEvent.click(screen.getByRole('button', { name: 'Skip' }))
  await screen.findByRole('button', { name: /add a policy priority/i })
  fireEvent.click(screen.getByRole('button', { name: 'Skip' }))

  await screen.findByRole('heading', {
    level: 1,
    name: /most want help with/i,
  })
}

const signupGoalWrites = (): Array<Record<string, unknown>> =>
  putBodies.filter((body) => 'signupGoal' in body)

beforeEach(() => {
  putBodies = []
  mockTrackEvent.mockClear()
  mockGetUserWebsite.mockReset().mockResolvedValue({ content: { about: {} } })
  mockSaveAboutFields.mockReset().mockResolvedValue(true)
  mswServer.use(
    http.put('/api/v1/campaigns/mine', async ({ request }) => {
      putBodies.push((await request.json()) as Record<string, unknown>)
      return HttpResponse.json({ id: 1 })
    }),
    http.patch('/api/v1/organizations/:slug', () => HttpResponse.json({})),
  )
  api.mock('GET /v1/campaigns/mine/story', {
    status: 200,
    data: { background: '' },
  })
})

describe('signup-goal step', () => {
  it('blocks Continue until a reason is selected', async () => {
    renderFlow()
    await advanceToSignupGoal()

    const continueButton = screen.getByRole('button', { name: 'Continue' })
    expect(continueButton).toBeDisabled()

    fireEvent.click(screen.getByLabelText(/voter data for my race/i))
    expect(continueButton).toBeEnabled()
  })

  it('persists the selection to the signupGoal column and fires Completed with the on-screen label', async () => {
    renderFlow()
    await advanceToSignupGoal()

    fireEvent.click(screen.getByLabelText(/reach voters/i))
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))

    // The column is the write path — details would be stripped by the
    // allowlist, which is how ballotStatus was silently lost before it moved.
    await waitFor(() =>
      expect(signupGoalWrites()).toEqual([{ signupGoal: 'voter-outreach' }]),
    )
    expect(mockTrackEvent).toHaveBeenCalledWith(
      EVENTS.OnboardingV2.SignupGoalCompleted,
      expect.objectContaining({
        signupGoal: 'voter-outreach',
        signupGoalLabel: 'I want to reach voters',
      }),
    )
    expect(
      await screen.findByText('Take our pledge to get your campaign plan'),
    ).toBeInTheDocument()
  })

  it('skips to the pledge without writing the column, firing Onboarding Skipped', async () => {
    renderFlow()
    await advanceToSignupGoal()

    fireEvent.click(screen.getByRole('button', { name: 'Skip' }))

    expect(
      await screen.findByText('Take our pledge to get your campaign plan'),
    ).toBeInTheDocument()
    expect(signupGoalWrites()).toEqual([])
    expect(mockTrackEvent).toHaveBeenCalledWith(
      EVENTS.OnboardingV2.OnboardingSkipped,
      expect.objectContaining({ step: 'Signup Goal' }),
    )
    expect(mockTrackEvent).not.toHaveBeenCalledWith(
      EVENTS.OnboardingV2.SignupGoalCompleted,
      expect.anything(),
    )
  })

  it('fires the Viewed event on entry', async () => {
    renderFlow()
    await advanceToSignupGoal()

    expect(mockTrackEvent).toHaveBeenCalledWith(
      EVENTS.OnboardingV2.SignupGoalViewed,
      expect.anything(),
    )
  })

  it('is step 9 of 10, immediately before the pledge', async () => {
    renderFlow()
    await advanceToSignupGoal()

    // Both paths run 10 visible steps: the structured one skips
    // manual-office-entry, the manual one skips path-to-victory. The
    // "Step X of Y" label was retired from the top bar; position is read
    // off the accessible progressbar attributes now.
    const stepper = screen.getByRole('progressbar', { name: 'Progress' })
    expect(stepper).toHaveAttribute('aria-valuenow', '9')
    expect(stepper).toHaveAttribute('aria-valuemax', '10')
  })
})
