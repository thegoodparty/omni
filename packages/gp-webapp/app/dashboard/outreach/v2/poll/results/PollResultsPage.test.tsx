import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type {
  OutreachDetail,
  PollResults,
  SmsOutreachReply,
} from '@goodparty_org/contracts'
import { render } from 'helpers/test-utils/render'
import { api } from 'helpers/test-utils/api-mocking'
import { EVENTS, trackEvent } from 'helpers/analyticsHelper'
import { PollResultsPage } from './PollResultsPage'

vi.mock('helpers/analyticsHelper', async (importOriginal) => ({
  ...(await importOriginal<typeof import('helpers/analyticsHelper')>()),
  trackEvent: vi.fn(),
}))

const callsOf = (event: string) =>
  vi
    .mocked(trackEvent)
    .mock.calls.filter(([name]) => name === event)
    .map(([, props]) => props)

vi.mock('app/dashboard/shared/DashboardLayout', () => ({
  default: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
}))

vi.mock('app/dashboard/polls/shared/audience-selection', () => ({
  useTotalConstituentsWithCellPhone: () => ({
    data: { totalConstituents: 20_000 },
    isPending: false,
    isUnavailable: false,
  }),
}))

const OUTREACH_ID = 41

const detail = (fields: Partial<OutreachDetail> = {}): OutreachDetail => ({
  id: OUTREACH_ID,
  createdAt: new Date('2026-10-01T00:00:00Z'),
  updatedAt: new Date('2026-10-01T00:00:00Z'),
  campaignId: null,
  outreachType: 'poll',
  projectId: null,
  name: 'Roads poll',
  status: 'completed',
  error: null,
  audienceRequest: null,
  script: null,
  message: 'What matters most to you about our roads?',
  date: new Date('2026-10-05T15:00:00Z'),
  imageUrl: null,
  voterFileFilterId: null,
  doorKnockingRouteId: null,
  phoneListId: null,
  identityId: null,
  didState: null,
  didNpaSubset: [],
  title: null,
  textCount: 1000,
  billableTextCount: 1000,
  campaignPlanDueDate: null,
  organizationSlug: 'eo-jane-doe',
  archivedAt: null,
  ...fields,
})

const results = (fields: Partial<PollResults> = {}): PollResults => ({
  outreachId: OUTREACH_ID,
  sent: 1000,
  responses: 120,
  responseRate: 0.12,
  optOutRate: 0.01,
  confidence: 0.12,
  isHighConfidence: true,
  notEnoughResponses: false,
  newSinceLastAnalysis: 0,
  lastAnalysisAt: null,
  themes: [
    {
      id: 'theme-1',
      label: 'Potholes',
      summary: 'Residents want the potholes filled.',
      mentionCount: 40,
      newMentions: 0,
      sampleQuotes: [],
    },
    {
      id: 'theme-2',
      label: 'Sidewalks',
      summary: 'Sidewalks are missing near schools.',
      mentionCount: 25,
      newMentions: 6,
      sampleQuotes: [],
    },
  ],
  nonClustered: { count: 12 },
  analysis: { status: 'completed' },
  expansions: [],
  ...fields,
})

const reply = (fields: Partial<SmsOutreachReply>): SmsOutreachReply => ({
  id: 'r1',
  personId: 'p1',
  firstName: 'Marcus',
  lastName: 'Webb',
  city: 'Springfield',
  state: 'IL',
  phone: '+15555550100',
  content: 'Please fix Elm Street.',
  receivedAt: '2026-10-06T15:00:00Z',
  isOptOut: false,
  favorited: false,
  read: false,
  ...fields,
})

const mockPage = (
  poll: Partial<PollResults> = {},
  outreach: Partial<OutreachDetail> = {},
) => {
  api.mock('GET /v1/outreach/serve/:id', {
    status: 200,
    data: detail(outreach),
  })
  api.mock('GET /v1/outreach/serve/:id/poll-results', {
    status: 200,
    data: results(poll),
  })
}

describe('PollResultsPage', () => {
  beforeEach(() => {
    window.scrollTo = vi.fn()
    api.reset()
  })

  it('shows the empty state and no themes under the response floor', async () => {
    mockPage({
      responses: 19,
      notEnoughResponses: true,
      confidence: null,
      isHighConfidence: false,
      themes: [],
      nonClustered: { count: 0 },
    })
    render(<PollResultsPage outreachId={OUTREACH_ID} />)

    expect(await screen.findByText('Not enough responses yet')).toBeVisible()
    expect(screen.queryByText('Top themes')).not.toBeInTheDocument()
    expect(screen.queryByText('Potholes')).not.toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Gather more feedback' }),
    ).toBeVisible()
  })

  it('shows ranked themes once there are enough responses', async () => {
    mockPage()
    render(<PollResultsPage outreachId={OUTREACH_ID} />)

    expect(await screen.findByText('Top themes')).toBeVisible()
    expect(screen.getByText('Potholes')).toBeVisible()
    expect(screen.getByText('Sidewalks')).toBeVisible()
    expect(screen.getByText('Poll confidence: high')).toBeVisible()
    expect(screen.getByText('12 responses')).toBeVisible()
  })

  it('shows "N new" only on a theme with new mentions', async () => {
    mockPage()
    render(<PollResultsPage outreachId={OUTREACH_ID} />)

    await screen.findByText('Potholes')
    expect(screen.getByText('6 new')).toBeVisible()
    expect(screen.getAllByText(/ new$/)).toHaveLength(1)
  })

  it('offers Gather more feedback from the low-confidence alert', async () => {
    mockPage({ isHighConfidence: false })
    render(<PollResultsPage outreachId={OUTREACH_ID} />)

    const alert = (await screen.findByText('Poll confidence: low')).closest(
      '[role="alert"]',
    ) as HTMLElement
    expect(
      within(alert).getByRole('button', { name: 'Gather more feedback' }),
    ).toBeVisible()
  })

  it('shows an open expansion as in review and holds off another', async () => {
    mockPage({
      isHighConfidence: false,
      expansions: [{ sendSeq: 2, textCount: 500, status: 'pending' }],
    })
    render(<PollResultsPage outreachId={OUTREACH_ID} />)

    expect(await screen.findByText('500 more constituents')).toBeVisible()
    expect(screen.getByText('In review')).toBeVisible()
    expect(
      screen.queryByRole('button', { name: 'Gather more feedback' }),
    ).not.toBeInTheDocument()
  })

  it('shows the replies ungrouped when the themes failed', async () => {
    mockPage({
      themes: [],
      nonClustered: { count: 0 },
      analysis: { status: 'failed' },
    })
    api.mock('GET /v1/outreach/serve/:id/replies', {
      status: 200,
      data: { total: 1, replies: [reply({})] },
    })
    render(<PollResultsPage outreachId={OUTREACH_ID} />)

    expect(await screen.findByText('Please fix Elm Street.')).toBeVisible()
    expect(screen.queryByText('Top themes')).not.toBeInTheDocument()
  })

  it('renders no reply box, reply-to-all or download control', async () => {
    mockPage()
    api.mock('GET /v1/outreach/serve/:id/replies', {
      status: 200,
      data: { total: 1, replies: [reply({})] },
    })
    render(<PollResultsPage outreachId={OUTREACH_ID} />)

    await userEvent.click(
      (await screen.findAllByRole('button', { name: /View responses/ }))[0]!,
    )
    await screen.findByText('Please fix Elm Street.')

    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
    expect(screen.queryByText(/Reply to all/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/Download/i)).not.toBeInTheDocument()
  })

  it('shows a poll still in review without results', async () => {
    api.mock('GET /v1/outreach/serve/:id', {
      status: 200,
      data: detail({ status: 'pending' }),
    })
    render(<PollResultsPage outreachId={OUTREACH_ID} />)

    expect(await screen.findByText('In review')).toBeVisible()
    expect(screen.queryByText('Responses')).not.toBeInTheDocument()
  })

  describe('analytics', () => {
    beforeEach(() => {
      vi.mocked(trackEvent).mockClear()
    })

    it('records one results view with what the official saw', async () => {
      mockPage()
      render(<PollResultsPage outreachId={OUTREACH_ID} />)
      await screen.findByText('Top themes')

      expect(callsOf(EVENTS.polls.resultsViewed)).toEqual([
        {
          outreachId: OUTREACH_ID,
          status: 'completed',
          phase: 'done',
          sent: 1000,
          responses: 120,
          isHighConfidence: true,
          notEnoughResponses: false,
          themeCount: 2,
        },
      ])
    })

    it('records a view of a poll that has not sent, without counts', async () => {
      api.mock('GET /v1/outreach/serve/:id', {
        status: 200,
        data: detail({ status: 'pending' }),
      })
      render(<PollResultsPage outreachId={OUTREACH_ID} />)
      await screen.findByText('In review')

      expect(callsOf(EVENTS.polls.resultsViewed)).toEqual([
        { outreachId: OUTREACH_ID, status: 'pending', phase: 'review' },
      ])
    })

    it('records opening a theme', async () => {
      mockPage()
      api.mock('GET /v1/outreach/serve/:id/replies', {
        status: 200,
        data: { total: 1, replies: [reply({})] },
      })
      render(<PollResultsPage outreachId={OUTREACH_ID} />)
      await userEvent.click(
        (await screen.findAllByRole('button', { name: /View responses/ }))[0]!,
      )

      expect(callsOf(EVENTS.polls.issueDetailsViewed)).toEqual([
        { outreachId: OUTREACH_ID, scope: 'theme' },
      ])
    })
  })
})

describe('PollResultsPage reply reader', () => {
  const flagBodies: Record<string, unknown>[] = []
  const queries: Record<string, string>[] = []

  const openTheme = async () => {
    render(<PollResultsPage outreachId={OUTREACH_ID} />)
    await userEvent.click(
      (await screen.findAllByRole('button', { name: /View responses/ }))[0]!,
    )
  }

  beforeEach(() => {
    window.scrollTo = vi.fn()
    api.reset()
    vi.mocked(trackEvent).mockClear()
    flagBodies.length = 0
    queries.length = 0
    mockPage()
    api.mock('GET /v1/outreach/serve/:id/replies', ({ query }) => {
      queries.push(query as Record<string, string>)
      return {
        status: 200,
        data: {
          total: 2,
          replies: [
            reply({
              id: 'r1',
              crm: { contactId: 'c9', statusLabel: 'Supporter' },
            }),
            reply({
              id: 'r2',
              firstName: 'Denise',
              content: 'More sidewalks please.',
              read: true,
            }),
          ].filter(
            (r) =>
              (query as Record<string, string>).filter !== 'unread' || !r.read,
          ),
        },
      }
    })
    api.mock(
      'PUT /v1/outreach/serve/:id/replies/:replyId/flags',
      ({ body }) => {
        flagBodies.push(body as Record<string, unknown>)
        return { status: 200, data: { favorited: true, read: true } }
      },
    )
  })

  it('reads the replies for the chosen theme', async () => {
    await openTheme()
    await screen.findByText('Please fix Elm Street.')
    expect(queries[0]).toMatchObject({ themeId: 'theme-1', filter: 'all' })
  })

  it('writes the favorite and shows it at once', async () => {
    await openTheme()
    const heart = await screen.findByRole('button', {
      name: 'Favorite the response from Marcus',
    })
    await userEvent.click(heart)

    expect(
      await screen.findByRole('button', {
        name: 'Remove the favorite on the response from Marcus',
      }),
    ).toHaveAttribute('aria-pressed', 'true')
    await waitFor(() => expect(flagBodies).toEqual([{ favorited: true }]))
    expect(callsOf(EVENTS.polls.replyFavorited)).toEqual([
      { outreachId: OUTREACH_ID, scope: 'theme' },
    ])
  })

  it('marks a response read only when it is opened', async () => {
    await openTheme()
    await screen.findByText('Please fix Elm Street.')
    expect(flagBodies).toEqual([])

    await userEvent.click(
      screen.getAllByRole('button', { name: 'Show details' })[0]!,
    )

    await waitFor(() => expect(flagBodies).toEqual([{ read: true }]))
    expect(screen.getByText('Supporter')).toBeVisible()
    expect(
      screen.getByRole('link', { name: 'Open their record' }),
    ).toHaveAttribute('href', '/dashboard/contacts/c9')
  })

  it('shows no phone, last name or address in the contact panel', async () => {
    await openTheme()
    await userEvent.click(
      (await screen.findAllByRole('button', { name: 'Show details' }))[0]!,
    )

    expect(screen.queryByText(/555/)).not.toBeInTheDocument()
    expect(screen.queryByText(/Webb/)).not.toBeInTheDocument()
    expect(screen.queryByText(/Springfield/)).not.toBeInTheDocument()
  })

  it('drops a response from Unread once it has been opened and closed', async () => {
    await openTheme()
    await userEvent.click(await screen.findByRole('tab', { name: 'Unread' }))
    await screen.findByText('Please fix Elm Street.')

    await userEvent.click(screen.getByRole('button', { name: 'Show details' }))
    await userEvent.click(screen.getByRole('button', { name: 'Hide details' }))

    await waitFor(() =>
      expect(
        screen.queryByText('Please fix Elm Street.'),
      ).not.toBeInTheDocument(),
    )
    expect(screen.getByText("You've read every response.")).toBeVisible()
  })
})
