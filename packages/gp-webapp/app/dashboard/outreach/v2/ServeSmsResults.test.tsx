import { describe, expect, it, vi } from 'vitest'
import { cleanup, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { render } from 'helpers/test-utils/render'
import { api } from 'helpers/test-utils/api-mocking'
import { OutreachDetailsDrawer } from './OutreachDetailsDrawer'
import { OutreachHistoryTable } from './OutreachHistoryTable'
import { fetchServeOutreachDetail } from './useOutreachDetail'
import type { HistoryRow } from './historyStatus.util'

vi.mock('@shared/organization-picker', () => ({
  useOrganization: () => ({ slug: 'eo-alex-rivera' }),
}))

vi.mock('helpers/useSnackbar', () => ({
  useSnackbar: () => ({
    displaySnackbar: vi.fn(),
    errorSnackbar: vi.fn(),
    successSnackbar: vi.fn(),
  }),
}))

const completedSmsRow: HistoryRow = {
  id: 77,
  createdAt: '2026-09-04T00:00:00Z',
  outreachType: 'text',
  name: 'Library hours',
  status: 'completed',
  textCount: 400,
}

const serveDetail = {
  id: 77,
  createdAt: new Date('2026-09-04T00:00:00Z'),
  updatedAt: new Date('2026-09-04T00:00:00Z'),
  campaignId: null,
  outreachType: 'text' as const,
  projectId: null,
  name: 'Library hours',
  status: 'completed' as const,
  error: null,
  audienceRequest: null,
  script: null,
  message: null,
  date: null,
  imageUrl: null,
  voterFileFilterId: null,
  doorKnockingRouteId: null,
  phoneListId: null,
  identityId: null,
  didState: null,
  didNpaSubset: [],
  title: null,
  textCount: 400,
  billableTextCount: null,
  campaignPlanDueDate: null,
  organizationSlug: 'eo-alex-rivera',
  archivedAt: null,
}

const reply = (overrides: Record<string, unknown> = {}) => ({
  id: 'reply-1',
  personId: '11111111-1111-4111-8111-111111111111',
  firstName: 'Dana',
  lastName: 'Whitfield',
  city: 'Northside',
  state: 'CO',
  phone: '+13035550101',
  content: 'Sunday hours would help a lot',
  receivedAt: '2026-09-05T15:00:00.000Z',
  isOptOut: false,
  ...overrides,
})

const mockServeDrawer = (
  replies: {
    total: number
    replies: ReturnType<typeof reply>[]
  } = { total: 1, replies: [reply()] },
) => {
  api.mock('GET /v1/outreach/serve/:id', { status: 200, data: serveDetail })
  api.mock('GET /v1/outreach/serve/:id/results', {
    status: 200,
    data: { contacts: 400, responded: 62, optedOut: 8 },
  })
  api.mock('GET /v1/outreach/serve/:id/replies', { status: 200, data: replies })
}

const renderServeDrawer = () =>
  render(
    <OutreachDetailsDrawer
      row={completedSmsRow}
      onOpenChange={vi.fn()}
      detailFetcher={fetchServeOutreachDetail}
      isServe
    />,
  )

describe('Serve SMS results — the Statistics card', () => {
  it('renders the identical three-row card from the org-scoped read', async () => {
    mockServeDrawer()

    renderServeDrawer()

    expect(
      await screen.findByText(/Based on 400 SMS contacts/),
    ).toBeInTheDocument()
    expect(screen.getByText('Responded')).toBeInTheDocument()
    expect(screen.getByText('62')).toBeInTheDocument()
    expect(screen.getByText('No response')).toBeInTheDocument()
    expect(screen.getByText('330')).toBeInTheDocument()
    expect(screen.getByText('Opted out')).toBeInTheDocument()
    expect(screen.getByText('8')).toBeInTheDocument()
  })

  it('never reads the Win campaign-scoped endpoint on a Serve drawer', async () => {
    mockServeDrawer()
    // Unmocked: msw fails an unhandled request, so a Win read here would
    // surface rather than silently 404 into the loading state.
    renderServeDrawer()

    expect(
      await screen.findByText(/Based on 400 SMS contacts/),
    ).toBeInTheDocument()
  })

  // Both surfaces share one QueryClient per browser session and number their
  // rows from the same auto-increment table, so a cache key without the
  // scope would let whichever resolved first answer for the other — no
  // network hit, wrong numbers, until gcTime expired. One tab moving between
  // /dashboard/outreach and /dashboard/constituent-outreach reaches it.
  it('does not serve one surface its results for the other surface, same id', async () => {
    api.mock('GET /v1/outreach/serve/:id/results', {
      status: 200,
      data: { contacts: 400, responded: 62, optedOut: 8 },
    })
    api.mock('GET /v1/outreach/:id/results', {
      status: 200,
      data: { contacts: 1204, responded: 186, optedOut: 9 },
    })
    api.mock('GET /v1/outreach/:id', {
      status: 200,
      data: { ...serveDetail, campaignId: 1, organizationSlug: null },
    })

    // Serve first: this populates the cache for outreach 77.
    render(
      <OutreachHistoryTable
        rows={[completedSmsRow]}
        onRowClick={vi.fn()}
        detailFetcher={fetchServeOutreachDetail}
        isServe
      />,
    )
    expect(
      await screen.findByText('62 responses · 8 unsub'),
    ).toBeInTheDocument()
    cleanup()

    // Same id, same cache, Win drawer. It must read Win's own numbers.
    render(
      <OutreachDetailsDrawer row={completedSmsRow} onOpenChange={vi.fn()} />,
    )

    expect(
      await screen.findByText(/Based on 1,204 SMS contacts/),
    ).toBeInTheDocument()
    expect(screen.getByText('186')).toBeInTheDocument()
    expect(screen.queryByText('62')).not.toBeInTheDocument()
  })
})

describe('Serve SMS results — the reply list', () => {
  it('lists a reply by first name with its content, and no Win-only chrome', async () => {
    mockServeDrawer()

    renderServeDrawer()

    expect(await screen.findByText('Responses')).toBeInTheDocument()
    expect(await screen.findByText('Dana')).toBeInTheDocument()
    expect(
      screen.getByText('Sunday hours would help a lot'),
    ).toBeInTheDocument()
    // Deferred for v1: favourites, read state and the thread.
    expect(
      screen.queryByRole('button', { name: /favorite|favourite/i }),
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole('textbox', { name: /repl/i }),
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: /unread|awaiting reply/i }),
    ).not.toBeInTheDocument()
  })

  it('opens the CRM panel on demand and keeps it shut until asked', async () => {
    mockServeDrawer()

    renderServeDrawer()

    expect(await screen.findByText('Dana')).toBeInTheDocument()
    expect(screen.queryByText('Northside, CO')).not.toBeInTheDocument()

    await userEvent.click(
      screen.getByRole('button', { name: 'Show contact details' }),
    )

    expect(screen.getByText('Dana Whitfield')).toBeInTheDocument()
    expect(screen.getByText('Northside, CO')).toBeInTheDocument()
    expect(screen.getByText('+13035550101')).toBeInTheDocument()
  })

  it('offers "Show all {n} responses" while the page is short of the total', async () => {
    mockServeDrawer({ total: 24, replies: [reply()] })

    renderServeDrawer()

    expect(
      await screen.findByRole('button', { name: 'Show all 24 responses' }),
    ).toBeInTheDocument()
  })

  // The server caps a page at SMS_OUTREACH_REPLIES_MAX_LIMIT (200), so a
  // send with more than that still to load cannot honestly promise "all".
  it('says "more" rather than "all" when one press cannot finish the list', async () => {
    mockServeDrawer({ total: 350, replies: [reply()] })

    renderServeDrawer()

    expect(await screen.findByText('350 responses')).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Show more responses' }),
    ).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: /Show all/ }),
    ).not.toBeInTheDocument()
  })

  // The regression: a growing `limit` was clamped back to 200 server-side, so
  // anything past that position could never be reached while the header went
  // on naming the full total. Offsets make every row reachable.
  it('pages past the server cap so the header never promises an unreachable row', async () => {
    const TOTAL = 205
    const all = Array.from({ length: TOTAL }, (_unused, index) =>
      reply({ id: `reply-${index}`, content: `Response number ${index + 1}` }),
    )
    api.mock('GET /v1/outreach/serve/:id', { status: 200, data: serveDetail })
    api.mock('GET /v1/outreach/serve/:id/results', {
      status: 200,
      data: { contacts: 400, responded: TOTAL, optedOut: 8 },
    })
    api.mock('GET /v1/outreach/serve/:id/replies', ({ query }) => {
      const offset = Number(query.offset ?? 0)
      const limit = Number(query.limit ?? 10)
      return {
        status: 200,
        data: { total: TOTAL, replies: all.slice(offset, offset + limit) },
      }
    })

    renderServeDrawer()

    expect(await screen.findByText('205 responses')).toBeInTheDocument()
    expect(screen.getByText('Response number 1')).toBeInTheDocument()
    expect(screen.queryByText('Response number 205')).not.toBeInTheDocument()

    await userEvent.click(
      screen.getByRole('button', { name: 'Show all 205 responses' }),
    )

    // The row past the old ceiling, which the capped-limit version could
    // never fetch.
    expect(await screen.findByText('Response number 205')).toBeInTheDocument()
    expect(screen.getByText('Response number 201')).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: /Show (all|more)/ }),
    ).not.toBeInTheDocument()
  })

  it('says so plainly when nothing has come back yet', async () => {
    mockServeDrawer({ total: 0, replies: [] })

    renderServeDrawer()

    expect(
      await screen.findByText(
        'No responses yet. They appear here as constituents reply.',
      ),
    ).toBeInTheDocument()
  })

  it('names an unnamed constituent rather than dropping the reply', async () => {
    mockServeDrawer({
      total: 1,
      replies: [reply({ firstName: null, lastName: null })],
    })

    renderServeDrawer()

    expect(await screen.findByText('Constituent')).toBeInTheDocument()
    expect(
      screen.getByText('Sunday hours would help a lot'),
    ).toBeInTheDocument()
  })
})

describe('Serve SMS results — the collapsed history row', () => {
  const desktopTable = () => screen.getAllByRole('table')[0] as HTMLElement

  it('summarises a completed SMS row as responses and unsubs', async () => {
    api.mock('GET /v1/outreach/serve/:id/results', {
      status: 200,
      data: { contacts: 400, responded: 62, optedOut: 8 },
    })

    render(
      <OutreachHistoryTable
        rows={[completedSmsRow]}
        onRowClick={vi.fn()}
        detailFetcher={fetchServeOutreachDetail}
        isServe
      />,
    )

    expect(
      await within(desktopTable()).findByText('62 responses · 8 unsub'),
    ).toBeInTheDocument()
  })

  it('leaves the Win column on its placeholder', () => {
    render(
      <OutreachHistoryTable rows={[completedSmsRow]} onRowClick={vi.fn()} />,
    )

    expect(within(desktopTable()).getByText('—')).toBeInTheDocument()
  })
})
