import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { RecommendedList } from '@goodparty_org/contracts'
import { render, testQueryClient } from 'helpers/test-utils/render'
import { api } from 'helpers/test-utils/api-mocking'
import { EVENTS, trackEvent } from 'helpers/analyticsHelper'
import { useContactsTable } from '../ContactsTableProvider'
import { useShowContactProModal } from '../ContactProModal'
import RecommendedListsSection from './RecommendedListsSection'

vi.mock('../ContactsTableProvider', () => ({
  useContactsTable: vi.fn(),
}))
vi.mock('../ContactProModal', () => ({
  useShowContactProModal: vi.fn(),
}))
vi.mock('@shared/organization-picker', () => ({
  useOrganization: () => ({ slug: 'test-org' }),
}))
vi.mock('helpers/analyticsHelper', async (importOriginal) => ({
  ...(await importOriginal<typeof import('helpers/analyticsHelper')>()),
  trackEvent: vi.fn(),
}))
vi.mock('./RecommendedListDetailSheet', () => ({
  default: ({
    recommendation,
    onClose,
  }: {
    recommendation: RecommendedList | null
    onClose: () => void
  }) =>
    recommendation ? (
      <div data-testid="recommended-detail-sheet">
        {recommendation.copy.title}
        <button onClick={onClose}>close sheet</button>
      </div>
    ) : null,
}))

const mockedUseContactsTable = vi.mocked(useContactsTable)
const showProModal = vi.fn()
const selectList = vi.fn()

const setContext = (
  overrides: Partial<ReturnType<typeof useContactsTable>> = {},
) => {
  mockedUseContactsTable.mockReturnValue({
    isWinContext: true,
    isWinContextReady: true,
    canUseProFeatures: true,
    voterDataUnavailable: false,
    selectList,
    ...overrides,
  } as unknown as ReturnType<typeof useContactsTable>)
}

const NEW_RECOMMENDATION: RecommendedList = {
  variant: 'introNeverIded',
  intent: 'introduce',
  filter: { voterStatus: ['Super', 'Likely'], supportStatus: ['unknown'] },
  count: 9590,
  voteGoalShare: 0.8,
  copy: {
    title: 'Meet voters who have not heard from you',
    criteriaSummary:
      'Moderate to high propensity voters with no recorded contact history.',
  },
  existingFilterId: null,
}

const EXISTING_RECOMMENDATION: RecommendedList = {
  variant: 'persuadeAffinity',
  intent: 'persuade',
  filter: { voterStatus: ['Super', 'Likely'], independentAffinity: true },
  count: 42468,
  copy: {
    title: 'Persuadable independent-leaning voters',
    criteriaSummary: 'Moderate to high propensity voters who lean independent.',
  },
  existingFilterId: 501,
}

beforeEach(() => {
  testQueryClient.clear()
  api.reset()
  vi.clearAllMocks()
  vi.mocked(useShowContactProModal).mockReturnValue(showProModal)
  setContext()
})

describe('RecommendedListsSection', () => {
  it('asks for the global universes and renders one card per recommendation', async () => {
    const queries: Record<string, unknown>[] = []
    api.mock('GET /v1/campaigns/mine/recommended-lists', ({ query }) => {
      queries.push(query)
      return {
        status: 200,
        data: [NEW_RECOMMENDATION, EXISTING_RECOMMENDATION],
      }
    })

    render(<RecommendedListsSection />)

    expect(
      await screen.findByText('Meet voters who have not heard from you'),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('heading', { name: 'Recommended voter lists' }),
    ).toBeInTheDocument()
    expect(
      screen.getByText(
        'Moderate to high propensity voters with no recorded contact history.',
      ),
    ).toBeInTheDocument()
    expect(screen.getByText('9,590')).toBeInTheDocument()
    expect(screen.getByText('42,468')).toBeInTheDocument()
    expect(screen.getAllByText('Recommended')).toHaveLength(2)
    // No channel and no intent: the page shows the lists before a channel
    // is picked, so the API's global mode is what it asks for.
    expect(queries[0]).not.toHaveProperty('channel')
    expect(queries[0]).not.toHaveProperty('intent')
  })

  it('renders nothing at all when there are no recommendations', async () => {
    api.mock('GET /v1/campaigns/mine/recommended-lists', {
      status: 200,
      data: [],
    })

    const { container } = render(<RecommendedListsSection />)

    await waitFor(() => expect(testQueryClient.isFetching()).toBe(0))
    expect(container).toBeEmptyDOMElement()
  })

  it('shows an error rather than an empty state when the warehouse is down', async () => {
    api.mock('GET /v1/campaigns/mine/recommended-lists', {
      status: 502,
      data: { message: 'Voter data is temporarily unavailable.' },
    })

    render(<RecommendedListsSection />)

    expect(
      await screen.findByText("We couldn't load recommendations right now."),
    ).toBeInTheDocument()
  })

  it('links Send outreach to the hub with the variant for an unsaved recommendation', async () => {
    api.mock('GET /v1/campaigns/mine/recommended-lists', {
      status: 200,
      data: [NEW_RECOMMENDATION],
    })

    render(<RecommendedListsSection />)

    const link = await screen.findByRole('link', { name: 'Send outreach' })
    expect(link).toHaveAttribute(
      'href',
      '/dashboard/outreach?recommended=introNeverIded',
    )

    await userEvent.click(link)
    expect(trackEvent).toHaveBeenCalledWith(
      EVENTS.VoterData.SendOutreachClicked,
      { surface: 'recommendedCard', variant: 'introNeverIded' },
    )
  })

  it('links Send outreach with the saved list id when the recommendation already exists', async () => {
    api.mock('GET /v1/campaigns/mine/recommended-lists', {
      status: 200,
      data: [EXISTING_RECOMMENDATION],
    })

    render(<RecommendedListsSection />)

    const link = await screen.findByRole('link', { name: 'Send outreach' })
    expect(link).toHaveAttribute('href', '/dashboard/outreach?listId=501')

    await userEvent.click(link)
    expect(trackEvent).toHaveBeenCalledWith(
      EVENTS.VoterData.SendOutreachClicked,
      { surface: 'recommendedCard', variant: 'persuadeAffinity', listId: 501 },
    )
  })

  it('opens the saved list detail sheet when the recommendation already exists', async () => {
    api.mock('GET /v1/campaigns/mine/recommended-lists', {
      status: 200,
      data: [EXISTING_RECOMMENDATION],
    })

    render(<RecommendedListsSection />)

    await userEvent.click(
      await screen.findByRole('button', { name: 'Details' }),
    )

    expect(selectList).toHaveBeenCalledWith('501')
    expect(screen.queryByTestId('recommended-detail-sheet')).toBeNull()
  })

  it('opens the recommendation detail sheet for an unsaved recommendation', async () => {
    api.mock('GET /v1/campaigns/mine/recommended-lists', {
      status: 200,
      data: [NEW_RECOMMENDATION],
    })

    render(<RecommendedListsSection />)

    await userEvent.click(
      await screen.findByRole('button', { name: 'Details' }),
    )

    const sheet = screen.getByTestId('recommended-detail-sheet')
    expect(
      within(sheet).getByText('Meet voters who have not heard from you'),
    ).toBeInTheDocument()
    expect(selectList).not.toHaveBeenCalled()

    await userEvent.click(within(sheet).getByText('close sheet'))
    expect(screen.queryByTestId('recommended-detail-sheet')).toBeNull()
  })

  it('shows the Pro notice and asks for nothing for a non-Pro campaign', async () => {
    let requested = false
    api.mock('GET /v1/campaigns/mine/recommended-lists', () => {
      requested = true
      return { status: 200, data: [NEW_RECOMMENDATION] }
    })
    setContext({ canUseProFeatures: false })

    render(<RecommendedListsSection />)

    expect(
      screen.getByText(
        'Recommended voter lists are a Pro feature. Upgrade to see who to reach and why.',
      ),
    ).toBeInTheDocument()
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(requested).toBe(false)

    await userEvent.click(screen.getByRole('button', { name: 'Upgrade' }))
    expect(showProModal).toHaveBeenCalledWith(true)
  })

  // Recommended lists are Win-only at the API (an eo- org gets a 400), and
  // Serve outreach has no hub to send to.
  it('renders nothing and asks for nothing for a Serve organization', async () => {
    let requested = false
    api.mock('GET /v1/campaigns/mine/recommended-lists', () => {
      requested = true
      return { status: 200, data: [NEW_RECOMMENDATION] }
    })
    setContext({ isWinContext: false })

    const { container } = render(<RecommendedListsSection />)

    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(requested).toBe(false)
    expect(container).toBeEmptyDOMElement()
  })

  it('renders nothing while the Win/Serve mode is still resolving', () => {
    api.mock('GET /v1/campaigns/mine/recommended-lists', {
      status: 200,
      data: [NEW_RECOMMENDATION],
    })
    setContext({ isWinContextReady: false })

    const { container } = render(<RecommendedListsSection />)

    expect(container).toBeEmptyDOMElement()
  })
})
