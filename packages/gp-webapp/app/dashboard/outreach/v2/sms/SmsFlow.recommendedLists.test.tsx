import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { render } from 'helpers/test-utils/render'
import { api } from 'helpers/test-utils/api-mocking'
import { WIN_RECOMMENDED_LISTS_FLAG_KEY } from '@shared/experiments/winRecommendedListsFlag'
import { SmsFlow } from './SmsFlow'

// The recommended-lists query lives inside useOutreachAudience, whose
// exposure/gating both read useWinRecommendedListsFlag — module-mocked here
// the same way CreateListWizard.flagExposure.test.tsx pins its own exposure
// contract, since it's the same flag and the same useFlagOn/useFeatureFlags
// seam.
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

vi.mock('@shared/experiments/voterOutreachV2SmsFlag', () => ({
  useVoterOutreachV2SmsFlag: () => ({ ready: true, enabled: false }),
}))

vi.mock('helpers/analyticsHelper', async (importOriginal) => ({
  ...(await importOriginal<typeof import('helpers/analyticsHelper')>()),
  trackEvent: vi.fn(),
}))

vi.mock('helpers/createP2pPhoneList', () => ({
  createP2pPhoneList: vi.fn(async () => ({ ok: true, token: 'tok-1' })),
  getP2pPhoneListStatus: vi.fn(async () => ({
    phoneListId: 77,
    leadsLoaded: 19000,
    excludedOptedOutCount: 0,
    excludedDuplicatePhoneCount: 0,
  })),
}))

vi.mock('@shared/hooks/useCampaign', () => ({
  useCampaign: () => [
    {
      id: 9,
      isPro: true,
      hasFreeTextsOffer: false,
      details: { normalizedOffice: 'City Council' },
    },
    vi.fn(),
  ],
}))
vi.mock('@shared/organization-picker', () => ({
  useOrganization: () => ({ slug: 'campaign-9', district: {} }),
}))
vi.mock('@shared/hooks/useUser', () => ({
  useUser: () => [{ id: 1, firstName: 'Jane' }, vi.fn(), false],
}))

const RECOMMENDATION = {
  variant: 'persuadeAffinity' as const,
  filter: { independentAffinity: true, voterStatus: ['Super', 'Likely'] },
  count: 19000,
  districtShare: 0.48,
  copy: {
    title: 'Persuadable independents',
    criteriaSummary: 'Moderate to high propensity voters',
  },
  existingFilterId: null,
}

const EXISTING_RECOMMENDATION = {
  ...RECOMMENDATION,
  variant: 'persuadeUndecided' as const,
  copy: {
    title: 'Undecided persuadables',
    criteriaSummary: 'Undecided voters',
  },
  existingFilterId: 501,
}

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
  api.mock('GET /v1/voters/voter-file/filters', { status: 200, data: [] })
  api.mock('GET /v1/elected-office/current', {
    status: 404,
    data: { message: 'No elected office' },
  })
  api.mock('GET /v1/outreach', { status: 200, data: [] })
})

const exposureCalls = () =>
  exposure.mock.calls.filter(([key]) => key === WIN_RECOMMENDED_LISTS_FLAG_KEY)

const openToAudience = async () => {
  const onClose = vi.fn()
  const onScheduled = vi.fn().mockResolvedValue(undefined)
  render(<SmsFlow open onClose={onClose} onScheduled={onScheduled} />)
  await userEvent.click(screen.getByText('Introduce myself'))
  expect(await screen.findByText('Who are you texting?')).toBeInTheDocument()
}

describe('SmsFlow — recommended lists', () => {
  it('records the exposure once the audience picker renders', async () => {
    api.mock('GET /v1/campaigns/mine/recommended-lists', {
      status: 200,
      data: [],
    })
    await openToAudience()

    expect(exposureCalls()).toHaveLength(1)
  })

  it('records the exposure for the control arm too', async () => {
    setFlag({ ready: true, on: false })
    await openToAudience()

    expect(exposureCalls()).toHaveLength(1)
  })

  it('shows nothing extra when the flag is off', async () => {
    setFlag({ ready: true, on: false })
    await openToAudience()

    expect(screen.queryByTestId('recommended-list-card')).toBeNull()
  })

  it('shows a card and carries its variant through to the created filter', async () => {
    api.mock('GET /v1/campaigns/mine/recommended-lists', {
      status: 200,
      data: [RECOMMENDATION],
    })
    api.mock('POST /v1/contacts/count', { status: 200, data: { count: 19000 } })
    const filterCalls: Record<string, unknown>[] = []
    api.mock('POST /v1/voters/voter-file/filter', ({ body }) => {
      filterCalls.push(body)
      return { status: 200, data: { id: 88, name: body.name } }
    })
    await openToAudience()

    await screen.findByText('Persuadable independents')
    expect(screen.getByText(/19,000 people/)).toBeInTheDocument()
    expect(screen.getByText(/48% of your district/)).toBeInTheDocument()

    await userEvent.click(screen.getByTestId('recommended-list-card'))

    // Landed on the name step with the recommendation's title prefilled and
    // still editable — "a candidate must still be able to edit the filter
    // before submitting" (Back reaches the filters step with the same
    // prefilled selection, matching the existing name -> filters Back path).
    expect(await screen.findByText('Name your list')).toBeInTheDocument()
    expect(screen.getByLabelText('List name')).toHaveValue(
      'Persuadable independents',
    )

    await userEvent.click(
      await screen.findByRole('button', { name: 'Continue' }),
    )

    expect(filterCalls).toHaveLength(1)
    expect(filterCalls[0]).toMatchObject({
      recommendedVariant: 'persuadeAffinity',
      recommendedChannel: 'sms',
      recommendedIntent: 'introduce',
    })
  })

  it('selects the existing list instead of creating a duplicate', async () => {
    // Overrides the empty default from beforeEach: the recommendation's
    // existingFilterId (501) must resolve against a real saved list, or the
    // picker has nothing to display as "selected".
    api.mock('GET /v1/voters/voter-file/filters', {
      status: 200,
      data: [{ id: 501, name: 'Undecided persuadables' }],
    })
    api.mock('GET /v1/campaigns/mine/recommended-lists', {
      status: 200,
      data: [EXISTING_RECOMMENDATION],
    })
    api.mock('GET /v1/contacts/list-detail', {
      status: 200,
      data: {
        demographics: { people: 19000, avgAge: null, avgIncome: null },
        reachability: {
          sms: 15000,
          robocall: null,
          phoneBanking: null,
          doorKnocking: null,
          polls: null,
        },
        outreachHistory: [],
      },
    })
    const filterCalls: unknown[] = []
    api.mock('POST /v1/voters/voter-file/filter', ({ body }) => {
      filterCalls.push(body)
      return { status: 200, data: { id: 999, name: 'should not be created' } }
    })
    await openToAudience()

    await userEvent.click(await screen.findByTestId('recommended-list-card'))

    // No name step, no create call — the saved list (id 501) is selected
    // directly and its reachable count resolves.
    expect(screen.queryByText('Name your list')).not.toBeInTheDocument()
    expect(filterCalls).toHaveLength(0)
    expect(await screen.findByText(/Message 15,000 voters/)).toBeInTheDocument()
  })

  it('renders the picker unchanged when there are no recommendations', async () => {
    api.mock('GET /v1/campaigns/mine/recommended-lists', {
      status: 200,
      data: [],
    })
    await openToAudience()

    expect(screen.queryByTestId('recommended-list-card')).toBeNull()
    expect(screen.getByText('Choose a voter list')).toBeInTheDocument()
  })

  it('shows a loading state while counts resolve', async () => {
    // Never resolves for the life of the test — enough to pin the loading
    // node without racing ofetch's own automatic GET retry (500/502/504 are
    // all in its default retryStatusCodes, so a single scripted resolution
    // would only settle the first of two real requests).
    api.mock(
      'GET /v1/campaigns/mine/recommended-lists',
      () => new Promise(() => undefined),
    )
    await openToAudience()

    expect(
      await screen.findByTestId('recommended-lists-loading'),
    ).toBeInTheDocument()
    expect(screen.queryByTestId('recommended-list-card')).toBeNull()
  })

  // The endpoint can also throw a 502/504 on a warehouse outage, deliberately
  // — that must never read as "no recommendations". A static persistent mock
  // (rather than a scripted one-shot resolve) is what's safe against ofetch's
  // automatic GET retry on 5xx: both the original attempt and the retry hit
  // this same handler and both come back 500.
  it('shows an error state distinct from the empty state, on top of the unchanged picker', async () => {
    api.mock('GET /v1/campaigns/mine/recommended-lists', {
      status: 500,
      data: { message: 'warehouse outage' },
    })
    await openToAudience()

    expect(
      await screen.findByTestId('recommended-lists-error'),
    ).toBeInTheDocument()
    expect(screen.queryByTestId('recommended-lists-loading')).toBeNull()
    expect(screen.queryByTestId('recommended-list-card')).toBeNull()
    expect(screen.getByText('Choose a voter list')).toBeInTheDocument()
  })
})
