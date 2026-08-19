import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'
import { render } from 'helpers/test-utils/render'
import { api } from 'helpers/test-utils/api-mocking'
import { trackEvent } from 'helpers/analyticsHelper'
import OnboardingPage from './OnboardingPage'

const mockOrg = vi.hoisted(() => ({ current: undefined as unknown }))
vi.mock('@shared/organization-picker', () => ({
  useOrganization: () => mockOrg.current,
}))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
}))
vi.mock('helpers/analyticsHelper', async (importOriginal) => ({
  ...(await importOriginal<typeof import('helpers/analyticsHelper')>()),
  trackEvent: vi.fn(),
}))
vi.mock('@shared/utils/analytics', () => ({
  identifyUser: vi.fn().mockResolvedValue(true),
}))
vi.mock('../../contexts/OnboardingContext', () => ({
  useOnboardingContext: () => ({
    submitOnboarding: vi.fn(),
    isSubmitting: false,
    submitError: null,
    user: { id: 1 },
    stepValidation: {},
    formData: {},
    demoMessageText: 'demo',
  }),
}))
vi.mock('./steps/InsightsStep', () => ({
  default: () => <div data-testid="insights-step" />,
}))
vi.mock('./steps/OutreachStep', () => ({ default: () => null }))
vi.mock('./steps/StrategyStep', () => ({ default: () => null }))
vi.mock('./steps/AddImageStep', () => ({ default: () => null }))
vi.mock('./steps/PreviewStep', () => ({ default: () => null }))
vi.mock('./steps/SwornInStep', () => ({ default: () => null }))
vi.mock('./steps/PickSendDateStep', () => ({ PickSendDateStep: () => null }))

const statsResponse = {
  districtId: 'district-1',
  computedAt: '2026-08-01T00:00:00.000Z',
  totalConstituents: 40000,
  totalConstituentsWithCellPhone: 20000,
  buckets: {
    age: [],
    homeowner: [],
    education: [],
    presenceOfChildren: [],
    estimatedIncomeRange: [],
  },
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

const resolvableOrg = {
  slug: 'eo-1',
  positionName: 'City Council',
  district: { id: 'd1', l2Type: 'City', l2Name: 'Austin' },
}

beforeEach(() => {
  mockOrg.current = resolvableOrg
})

// Polls is a Serve feature and Serve has no Pro gate (canUseProFeatures is always
// true for an eo- org), so the district gate is the only protection here. Insights
// is step 1, so an unresolvable office previously hit this on its first screen.
describe('polls OnboardingPage — district gate', () => {
  const mockStats = () => {
    const onRequest = vi.fn()
    api.mock('GET /v1/contacts/stats', () => {
      onRequest()
      return { status: 200, data: statsResponse }
    })
    return onRequest
  }

  it('fetches stats and renders the flow when a district resolves', async () => {
    const onRequest = mockStats()

    render(<OnboardingPage />)
    await flush()

    expect(onRequest).toHaveBeenCalled()
    expect(await screen.findByTestId('insights-step')).toBeInTheDocument()
  })

  it('fires no stats request when the district is unresolvable', async () => {
    const onRequest = mockStats()
    mockOrg.current = { ...resolvableOrg, district: null }

    render(<OnboardingPage />)
    await flush()

    expect(onRequest).not.toHaveBeenCalled()
  })

  it('blocks the flow with a terminal state instead of rendering step 1', async () => {
    mockStats()
    mockOrg.current = { ...resolvableOrg, district: null }

    render(<OnboardingPage />)
    await flush()

    expect(screen.queryByTestId('insights-step')).not.toBeInTheDocument()
    expect(
      screen.getByText(/don't have constituent data for this office yet/i),
    ).toBeInTheDocument()
  })

  // The org resolves a district, so the predicate says "available" — only the
  // request's own outcome reveals that the district has no DistrictStats row.
  it('blocks the flow when a resolvable district has no stats', async () => {
    api.mock('GET /v1/contacts/stats', {
      status: 400,
      data: {
        message: 'District stats not available',
        errorCode: 'VOTER_DATA_UNAVAILABLE',
      },
    })

    render(<OnboardingPage />)

    expect(
      await screen.findByText(/don't have constituent data for this office/i),
    ).toBeInTheDocument()
    expect(screen.queryByTestId('insights-step')).not.toBeInTheDocument()
  })

  // The two populations need to stay separable: a write-in office name is the
  // user's to fix, a missing stats row is ours.
  it('reports the block with the reason that caused it', async () => {
    mockStats()
    mockOrg.current = { ...resolvableOrg, district: null }

    render(<OnboardingPage />)
    await flush()

    expect(trackEvent).toHaveBeenCalledWith(
      'Polls - Constituent Data Unavailable Viewed',
      { source: 'onboarding', reason: 'unresolvable_district' },
    )
  })

  // A transient failure must not claim the office has no data — that's false,
  // and Contacts can't help. It gets its own copy and a way back.
  it('offers a retry instead of the support handoff on a transient failure', async () => {
    api.mock('GET /v1/contacts/stats', {
      status: 500,
      data: { message: 'upstream unavailable' },
    })

    render(<OnboardingPage />)

    // Two retries with backoff run before the error state settles.
    expect(
      await screen.findByText(
        /couldn't load your constituent data/i,
        undefined,
        {
          timeout: 5000,
        },
      ),
    ).toBeInTheDocument()
    expect(
      screen.queryByText(/don't have constituent data for this office/i),
    ).not.toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: /try again/i }),
    ).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: /visit contacts/i }),
    ).not.toBeInTheDocument()
  })

  it('distinguishes a missing stats row from an unresolvable district', async () => {
    api.mock('GET /v1/contacts/stats', {
      status: 400,
      data: {
        message: 'District stats not available',
        errorCode: 'VOTER_DATA_UNAVAILABLE',
      },
    })

    render(<OnboardingPage />)
    await screen.findByText(/don't have constituent data for this office/i)

    expect(trackEvent).toHaveBeenCalledWith(
      'Polls - Constituent Data Unavailable Viewed',
      { source: 'onboarding', reason: 'stats_unavailable' },
    )
  })

  // Mirrors the existing NotEnoughConstituents bail-out, which routes to
  // contacts rather than duplicating a support handoff here — the contacts page
  // already explains the problem and offers support.
  it('offers the contacts route as the way forward', async () => {
    mockStats()
    mockOrg.current = { ...resolvableOrg, district: null }

    render(<OnboardingPage />)
    await flush()

    expect(
      screen.getByRole('button', { name: /visit contacts/i }),
    ).toBeInTheDocument()
  })
})
