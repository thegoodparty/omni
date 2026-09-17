import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { render } from 'helpers/test-utils/render'
import { api } from 'helpers/test-utils/api-mocking'
import { RobocallFlow } from './RobocallFlow'

vi.mock('helpers/analyticsHelper', async (importOriginal) => ({
  ...(await importOriginal<typeof import('helpers/analyticsHelper')>()),
  trackEvent: vi.fn(),
}))

vi.mock('@shared/organization-picker', () => ({
  useOrganization: () => ({ slug: 'test-org' }),
}))

const RECOMMENDATION = {
  variant: 'persuadeAffinity' as const,
  intent: 'persuade' as const,
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

beforeEach(() => {
  api.reset()
  vi.clearAllMocks()
  api.mock('GET /v1/elected-office/current', {
    status: 404,
    data: { message: 'No elected office' },
  })
  api.mock('GET /v1/voters/voter-file/filters', { status: 200, data: [] })
})

const openToAudience = async () => {
  render(<RobocallFlow open onClose={vi.fn()} />)
  await userEvent.click(screen.getByText('Introduce myself to voters'))
  expect(
    await screen.findByText(/Choose a voter list|View your lists here/),
  ).toBeInTheDocument()
}

describe('RobocallFlow — a recommendation carried in from the voter data page', () => {
  it('selects the saved list on the audience step when the variant already exists', async () => {
    api.mock('GET /v1/voters/voter-file/filters', {
      status: 200,
      data: [{ id: 501, name: 'Persuadable independents' }],
    })
    api.mock('GET /v1/campaigns/mine/recommended-lists', ({ query }) => ({
      status: 200,
      data:
        query.variant === 'persuadeAffinity'
          ? [{ ...RECOMMENDATION, existingFilterId: 501 }]
          : [],
    }))
    api.mock('GET /v1/contacts/list-detail', {
      status: 200,
      data: {
        demographics: { people: 12000, avgAge: null, avgIncome: null },
        reachability: {
          sms: null,
          robocall: 9000,
          phoneBanking: null,
          doorKnocking: null,
          polls: null,
        },
        outreachHistory: [],
      },
    })
    render(
      <RobocallFlow
        open
        onClose={vi.fn()}
        preselectedRecommendedVariant="persuadeAffinity"
      />,
    )
    await userEvent.click(screen.getByText('Introduce myself to voters'))

    expect(
      await screen.findByText(/Reach 9,000 supporters with landlines/),
    ).toBeInTheDocument()
    expect(screen.queryByText('Name this list')).not.toBeInTheDocument()
  })
})

describe('RobocallFlow — recommended lists', () => {
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

    expect(await screen.findByText('Name this list')).toBeInTheDocument()
    expect(screen.getByLabelText('List name')).toHaveValue(
      'Persuadable independents',
    )

    await userEvent.click(
      await screen.findByRole('button', { name: 'Continue' }),
    )

    expect(filterCalls).toHaveLength(1)
    expect(filterCalls[0]).toMatchObject({
      recommendedVariant: 'persuadeAffinity',
      recommendedChannel: 'robocall',
      // The variant's own intent, not the purpose picked to reach it.
      recommendedIntent: 'persuade',
    })
  })

  it('renders the picker unchanged when there are no recommendations', async () => {
    api.mock('GET /v1/campaigns/mine/recommended-lists', {
      status: 200,
      data: [],
    })
    await openToAudience()

    expect(screen.queryByTestId('recommended-list-card')).toBeNull()
    expect(
      screen.getByText(/Choose a voter list|View your lists here/),
    ).toBeInTheDocument()
  })
})
