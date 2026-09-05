import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { render } from 'helpers/test-utils/render'
import { api } from 'helpers/test-utils/api-mocking'
import { WIN_RECOMMENDED_LISTS_FLAG_KEY } from '@shared/experiments/winRecommendedListsFlag'
import {
  PhoneBankingFlow,
  SERVE_PHONE_BANKING_SURFACE,
} from './PhoneBankingFlow'

// Same seam as SmsFlow.recommendedLists.test.tsx / RobocallFlow.recommendedLists.test.tsx.
vi.mock('@shared/experiments/FeatureFlagsProvider', () => ({
  useFlagOn: vi.fn(),
  useFeatureFlags: vi.fn(),
}))

const { useFlagOn, useFeatureFlags } =
  await import('@shared/experiments/FeatureFlagsProvider')
const mockedUseFlagOn = vi.mocked(useFlagOn)
const mockedUseFeatureFlags = vi.mocked(useFeatureFlags)
const exposure = vi.fn()

const setFlag = ({
  ready = true,
  on = true,
}: {
  ready?: boolean
  on?: boolean
}) => {
  mockedUseFlagOn.mockReturnValue({ ready, on })
}

vi.mock('helpers/analyticsHelper', async (importOriginal) => ({
  ...(await importOriginal<typeof import('helpers/analyticsHelper')>()),
  trackEvent: vi.fn(),
}))

vi.mock('@shared/organization-picker', () => ({
  useOrganization: () => ({ slug: 'test-org' }),
}))

const RECOMMENDATION = {
  variant: 'persuadeAffinity' as const,
  filter: { independentAffinity: true, voterStatus: ['Super', 'Likely'] },
  count: 8000,
  voteGoalShare: 0.22,
  copy: {
    title: 'Persuadable independents',
    criteriaSummary: 'Moderate to high propensity voters',
  },
  existingFilterId: null,
}

const exposureCalls = () =>
  exposure.mock.calls.filter(([key]) => key === WIN_RECOMMENDED_LISTS_FLAG_KEY)

beforeEach(() => {
  api.reset()
  vi.clearAllMocks()
  mockedUseFeatureFlags.mockReturnValue({
    ready: true,
    variant: () => ({ value: undefined }),
    all: () => ({}),
    exposure,
    refresh: vi.fn(),
    clear: vi.fn(),
  } as ReturnType<typeof useFeatureFlags>)
  setFlag({ ready: true, on: true })
  api.mock('GET /v1/elected-office/current', {
    status: 404,
    data: { message: 'No elected office' },
  })
  api.mock('GET /v1/voters/voter-file/filters', { status: 200, data: [] })
})

describe('PhoneBankingFlow (Win surface) — recommended lists', () => {
  const openToWho = async () => {
    render(<PhoneBankingFlow open onClose={vi.fn()} />)
    await userEvent.click(screen.getByText('Introduce myself to voters'))
    expect(
      await screen.findByText(/Choose a voter list|View your lists here/),
    ).toBeInTheDocument()
  }

  it('records the exposure and carries the variant/channel/intent through', async () => {
    api.mock('GET /v1/campaigns/mine/recommended-lists', {
      status: 200,
      data: [RECOMMENDATION],
    })
    api.mock('POST /v1/contacts/count', { status: 200, data: { count: 8000 } })
    const filterCalls: Record<string, unknown>[] = []
    api.mock('POST /v1/voters/voter-file/filter', ({ body }) => {
      filterCalls.push(body)
      return { status: 200, data: { id: 88, name: body.name } }
    })
    await openToWho()

    expect(exposureCalls()).toHaveLength(1)
    await screen.findByText('Persuadable independents')
    expect(screen.getByText(/8,000 people/)).toBeInTheDocument()
    // Volunteer-run, so gp-api sends no cost and the card must show none.
    // "$0.00 to reach them" would read as free rather than not applicable.
    expect(screen.queryByText(/to reach them/)).not.toBeInTheDocument()

    await userEvent.click(screen.getByTestId('recommended-list-card'))
    await screen.findByText('Name this list')
    await userEvent.click(
      await screen.findByRole('button', { name: 'Continue' }),
    )

    expect(filterCalls).toHaveLength(1)
    expect(filterCalls[0]).toMatchObject({
      recommendedVariant: 'persuadeAffinity',
      recommendedChannel: 'phoneBanking',
      recommendedIntent: 'introduce',
    })
  })
})

// The Serve surface reuses some of the same purpose slugs (introduce_myself,
// event_invite, custom) for an unrelated, non-electoral meaning — recommended
// lists are Win-only (the endpoint 400s an eo- org), so this proves the
// shared slug never leaks a Win recommendations call into a Serve flow, which
// would otherwise render a spurious "couldn't load recommendations" error on
// every Serve phone-banking session.
describe('PhoneBankingFlow (Serve surface) — recommended lists', () => {
  it('never requests or renders recommendations, even on a shared purpose slug', async () => {
    let requested = false
    api.mock('GET /v1/campaigns/mine/recommended-lists', () => {
      requested = true
      return { status: 200, data: [RECOMMENDATION] }
    })
    // Purpose selection eagerly drafts a script; unrelated to this test but
    // needs a handler or MSW logs an unhandled-request warning.
    api.mock('POST /v1/outreach/serve/phone-banking/draft', {
      status: 200,
      data: { draft: 'draft' },
    })
    render(
      <PhoneBankingFlow
        open
        onClose={vi.fn()}
        surface={SERVE_PHONE_BANKING_SURFACE}
      />,
    )

    await userEvent.click(screen.getByText('Introduce myself to constituents'))
    expect(
      await screen.findByText(/Choose a voter list|View your lists here/),
    ).toBeInTheDocument()

    expect(requested).toBe(false)
    expect(screen.queryByTestId('recommended-list-card')).toBeNull()
    expect(exposureCalls()).toHaveLength(0)
  })
})
