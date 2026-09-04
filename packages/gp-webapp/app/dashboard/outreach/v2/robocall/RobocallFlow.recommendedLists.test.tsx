import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { render } from 'helpers/test-utils/render'
import { api } from 'helpers/test-utils/api-mocking'
import { WIN_RECOMMENDED_LISTS_FLAG_KEY } from '@shared/experiments/winRecommendedListsFlag'
import { RobocallFlow } from './RobocallFlow'

// Same seam as SmsFlow.recommendedLists.test.tsx: the recommendations query
// and its exposure both live inside useOutreachAudience, gated on
// useWinRecommendedListsFlag/useFeatureFlags.
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
  count: 12000,
  voteGoalShare: 0.31,
  estimatedCostCents: 54_000,
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

const openToAudience = async () => {
  render(<RobocallFlow open onClose={vi.fn()} />)
  await userEvent.click(screen.getByText('Introduce myself to voters'))
  expect(await screen.findByText('Choose a voter list')).toBeInTheDocument()
}

describe('RobocallFlow — recommended lists', () => {
  it('records the exposure once the audience picker renders', async () => {
    api.mock('GET /v1/campaigns/mine/recommended-lists', {
      status: 200,
      data: [],
    })
    await openToAudience()

    expect(exposureCalls()).toHaveLength(1)
  })

  it('shows nothing extra when the flag is off', async () => {
    setFlag({ ready: true, on: false })
    await openToAudience()

    expect(screen.queryByTestId('recommended-list-card')).toBeNull()
  })

  it('shows a card and carries its variant, channel and intent through to the created filter', async () => {
    api.mock('GET /v1/campaigns/mine/recommended-lists', {
      status: 200,
      data: [RECOMMENDATION],
    })
    api.mock('POST /v1/contacts/count', { status: 200, data: { count: 12000 } })
    const filterCalls: Record<string, unknown>[] = []
    api.mock('POST /v1/voters/voter-file/filter', ({ body }) => {
      filterCalls.push(body)
      return { status: 200, data: { id: 88, name: body.name } }
    })
    await openToAudience()

    await screen.findByText('Persuadable independents')
    expect(screen.getByText(/12,000 people/)).toBeInTheDocument()
    expect(screen.getByText(/31% of your vote goal/)).toBeInTheDocument()
    expect(screen.getByText(/\$540\.00 to reach them/)).toBeInTheDocument()

    await userEvent.click(screen.getByTestId('recommended-list-card'))

    expect(await screen.findByText('Name your list')).toBeInTheDocument()
    expect(screen.getByLabelText('List name')).toHaveValue(
      'Persuadable independents',
    )

    await userEvent.click(
      await screen.findByRole('button', { name: 'Create list' }),
    )

    expect(filterCalls).toHaveLength(1)
    expect(filterCalls[0]).toMatchObject({
      recommendedVariant: 'persuadeAffinity',
      recommendedChannel: 'robocall',
      recommendedIntent: 'introduce',
    })
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
})
