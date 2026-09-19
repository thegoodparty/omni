import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { render } from 'helpers/test-utils/render'
import { api } from 'helpers/test-utils/api-mocking'
import {
  PhoneBankingFlow,
  SERVE_PHONE_BANKING_SURFACE,
} from './PhoneBankingFlow'

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
  count: 8000,
  voteGoalShare: 0.22,
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

describe('PhoneBankingFlow (Win surface) — recommended lists', () => {
  const openToWho = async () => {
    render(<PhoneBankingFlow open onClose={vi.fn()} />)
    await userEvent.click(screen.getByText('Introduce myself to voters'))
    expect(
      await screen.findByText(/Choose a voter list|View your lists here/),
    ).toBeInTheDocument()
  }

  it('carries the variant/channel/intent through to the created filter', async () => {
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
      // The variant's own intent, not the purpose picked to reach it.
      recommendedIntent: 'persuade',
    })
  })
})

describe('PhoneBankingFlow (Win surface) — a recommendation carried in, not saved yet', () => {
  it('opens on the who step with the variant’s purpose picked and drafted, the card selected, and saves it under its own title on Continue', async () => {
    api.mock('GET /v1/campaigns/mine/recommended-lists', ({ query }) => ({
      status: 200,
      data: query.variant === 'persuadeAffinity' ? [RECOMMENDATION] : [],
    }))
    const draftCalls: Record<string, unknown>[] = []
    api.mock('POST /v1/outreach/phone-banking/draft', ({ body }) => {
      draftCalls.push(body)
      return { status: 200, data: { draft: 'drafted script' } }
    })
    const filterCalls: Record<string, unknown>[] = []
    api.mock('POST /v1/voters/voter-file/filter', ({ body }) => {
      filterCalls.push(body)
      return { status: 200, data: { id: 88, name: body.name } }
    })
    render(
      <PhoneBankingFlow
        open
        onClose={vi.fn()}
        preselectedRecommendedVariant="persuadeAffinity"
      />,
    )

    // The card's intent is the purpose: no question asked, and the script
    // drafts for it exactly as tapping "Persuade likely voters" would.
    expect(screen.queryByText('Introduce myself to voters')).toBeNull()
    await waitFor(() => expect(draftCalls).toHaveLength(1))
    expect(draftCalls[0]).toMatchObject({
      purpose: 'persuade_voters',
      tone: 'warm',
    })

    const card = await screen.findByTestId('recommended-list-card')
    await waitFor(() => expect(card).toHaveAttribute('aria-pressed', 'true'))
    expect(screen.queryByText('Name this list')).not.toBeInTheDocument()

    await userEvent.click(
      await screen.findByRole('button', { name: 'Continue (8,000)' }),
    )

    await waitFor(() => expect(filterCalls).toHaveLength(1))
    expect(filterCalls[0]).toMatchObject({
      name: 'Persuadable independents',
      recommendedVariant: 'persuadeAffinity',
      recommendedChannel: 'phoneBanking',
      recommendedIntent: 'persuade',
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
  })
})
