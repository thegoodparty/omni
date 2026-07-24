import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { render } from 'helpers/test-utils/render'
import { api, mswServer } from 'helpers/test-utils/api-mocking'
import { useSnackbar } from 'helpers/useSnackbar'
import { EVENTS, trackEvent } from 'helpers/analyticsHelper'
import { useContactsTable } from '../ContactsTableProvider'
import { useContactsDownload } from '../shared/useContactsDownload'
import { LOCKED_LIST_MESSAGE } from '../shared/constants'
import ListDetailSheet from './ListDetailSheet'

vi.mock('@shared/organization-picker', () => ({
  useOrganization: () => ({ slug: 'test-org' }),
}))
vi.mock('../ContactsTableProvider', () => ({
  useContactsTable: vi.fn(),
}))
vi.mock('helpers/useSnackbar', () => ({
  useSnackbar: vi.fn(),
}))
vi.mock('helpers/analyticsHelper', async (importOriginal) => ({
  ...(await importOriginal<typeof import('helpers/analyticsHelper')>()),
  trackEvent: vi.fn(),
}))
// Mocked so the ENG-10709 analytics tests can invoke the cookie-poll success
// callback synchronously, without re-driving useContactsDownload's own
// timer/cookie mechanics — those are already covered by
// useContactsDownload.test.ts. Other describe blocks in this file never
// click Download, so this has no effect on them.
vi.mock('../shared/useContactsDownload', () => ({
  useContactsDownload: vi.fn(),
}))
// The real DropdownMenuItem depends on Radix context provided by its
// DropdownMenu/DropdownMenuContent ancestors (createContextScope) and throws
// without them — so the kebab menu's Delete trigger is mocked down to plain
// elements (same approach as MoreMenu.test.tsx) rather than driving Radix's
// floating-ui positioning, which nothing else in this test suite exercises.
// Everything else in the barrel (Drawer, Dialog, AlertDialog, Button, …)
// stays real, so the sheet + RenameListDialog/DeleteListDialog interactions
// are exercised for real.
vi.mock('@styleguide', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>()
  return {
    ...actual,
    DropdownMenu: ({ children }: { children: React.ReactNode }) => (
      <>{children}</>
    ),
    DropdownMenuTrigger: ({ children }: { children: React.ReactNode }) => (
      <>{children}</>
    ),
    DropdownMenuContent: ({ children }: { children: React.ReactNode }) => (
      <>{children}</>
    ),
    DropdownMenuItem: ({
      children,
      onClick,
      'data-testid': dataTestId,
    }: {
      children: React.ReactNode
      onClick?: () => void
      'data-testid'?: string
    }) => (
      <button data-testid={dataTestId} onClick={onClick}>
        {children}
      </button>
    ),
  }
})

// Stable mock references (not a fresh vi.fn() per useSnackbar() call) — both
// useContactsDownload and useDuplicateList call useSnackbar() independently
// from inside the sheet, so the test needs one shared instance to assert
// against regardless of which internal hook fired it.
const mockedUseSnackbar = vi.mocked(useSnackbar)
const mockedUseContactsTable = vi.mocked(useContactsTable)
const mockedUseContactsDownload = vi.mocked(useContactsDownload)
const successSnackbar = vi.fn()
const errorSnackbar = vi.fn()
const downloadFn = vi.fn()
const selectList = vi.fn()

type ContextValue = ReturnType<typeof useContactsTable>

const setContext = (overrides: Partial<ContextValue> = {}) => {
  mockedUseContactsTable.mockReturnValue({
    canUseProFeatures: true,
    isElectedOfficial: false,
    isWinContext: true,
    isWinContextReady: true,
    selectList,
    ...overrides,
  } as ContextValue)
}

// ENG-10767: the sheet now fires Segment Viewed on open, so assertions about
// other events filter by event name instead of counting every trackEvent
// call.
const eventCalls = (event: string) =>
  vi.mocked(trackEvent).mock.calls.filter(([name]) => name === event)

const emptyDetailResponse = {
  demographics: { people: 100, avgAge: 42, avgIncome: 65000 },
  reachability: {
    sms: 100,
    robocall: 100,
    phoneBanking: 100,
    doorKnocking: 100,
    polls: 100,
  },
  outreachHistory: [],
}

beforeEach(() => {
  api.reset()
  vi.clearAllMocks()
  mockedUseSnackbar.mockReturnValue({
    successSnackbar,
    errorSnackbar,
    displaySnackbar: vi.fn(),
  })
  setContext()
  mockedUseContactsDownload.mockReturnValue({
    download: downloadFn,
    isPreparing: false,
  })
  api.mock('GET /v1/contacts/list-detail', {
    status: 200,
    data: emptyDetailResponse,
  })
})

describe('ListDetailSheet — Lovable stat tiles', () => {
  it('rounds the average age to an integer and formats income', async () => {
    api.mock('GET /v1/voters/voter-file/filters', {
      status: 200,
      data: [{ id: 42, name: 'GOTV text list' }],
    })
    api.mock('GET /v1/contacts/list-detail', {
      status: 200,
      data: {
        ...emptyDetailResponse,
        demographics: { people: 100, avgAge: 52.782, avgIncome: 65000.4 },
      },
    })

    render(<ListDetailSheet listId="42" onClose={vi.fn()} />)

    expect(await screen.findByText('53')).toBeInTheDocument()
    expect(screen.queryByText('52.782')).not.toBeInTheDocument()
    expect(screen.getByText('$65,000')).toBeInTheDocument()
  })

  // ENG-10775: people-api floors a slow aggregates query at FENCE_LIMIT
  // (10,000) instead of finishing the exact count — the People tile must
  // never present that floor as if it were exact.
  it('renders a trailing + on the People tile when the count is a fenced lower bound', async () => {
    api.mock('GET /v1/voters/voter-file/filters', {
      status: 200,
      data: [{ id: 42, name: 'GOTV text list' }],
    })
    api.mock('GET /v1/contacts/list-detail', {
      status: 200,
      data: {
        ...emptyDetailResponse,
        demographics: {
          people: 10000,
          avgAge: 42,
          avgIncome: 65000,
          fenced: true,
        },
      },
    })

    render(<ListDetailSheet listId="42" onClose={vi.fn()} />)

    expect(await screen.findByText('10,000+')).toBeInTheDocument()
  })

  it('renders the outreach-history table columns and the empty state', async () => {
    api.mock('GET /v1/voters/voter-file/filters', {
      status: 200,
      data: [{ id: 42, name: 'GOTV text list' }],
    })
    api.mock('GET /v1/contacts/list-detail', {
      status: 200,
      data: {
        ...emptyDetailResponse,
        outreachHistory: [
          {
            id: 9,
            name: 'GOTV blast',
            outreachType: 'text',
            status: 'completed',
            date: new Date('2026-06-22T00:00:00.000Z'),
          },
        ],
      },
    })

    render(<ListDetailSheet listId="42" onClose={vi.fn()} />)

    expect(await screen.findByText('GOTV blast')).toBeInTheDocument()
    expect(
      screen.getByRole('columnheader', { name: 'Date' }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('columnheader', { name: 'Name' }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('columnheader', { name: 'Channel' }),
    ).toBeInTheDocument()
    expect(screen.queryByText('No outreach yet.')).not.toBeInTheDocument()
  })

  it('renders channel nouns and a name fallback for an unnamed robocall (ENG-10769)', async () => {
    api.mock('GET /v1/voters/voter-file/filters', {
      status: 200,
      data: [{ id: 42, name: 'Males 50+' }],
    })
    api.mock('GET /v1/contacts/list-detail', {
      status: 200,
      data: {
        ...emptyDetailResponse,
        outreachHistory: [
          {
            id: 9,
            name: null,
            outreachType: 'robocall',
            status: 'pending',
            date: new Date('2026-07-27T00:00:00.000Z'),
          },
        ],
      },
    })

    render(<ListDetailSheet listId="42" onClose={vi.fn()} />)

    // Name falls back to channel + date, never the activity-feed verb.
    expect(
      await screen.findByText('Robocall — Jul 27, 2026'),
    ).toBeInTheDocument()
    expect(screen.queryByText('Called')).not.toBeInTheDocument()
    // Channel chip + Last-method tile + reachability tile all say "Robocall".
    expect(screen.getAllByText('Robocall').length).toBeGreaterThanOrEqual(3)
  })

  it('shows the empty outreach sentence when there are no rows', async () => {
    api.mock('GET /v1/voters/voter-file/filters', {
      status: 200,
      data: [{ id: 42, name: 'GOTV text list' }],
    })

    render(<ListDetailSheet listId="42" onClose={vi.fn()} />)

    expect(await screen.findByText('No outreach yet.')).toBeInTheDocument()
  })

  it('renders the mode-aware details heading and sentence-cased channel labels', async () => {
    api.mock('GET /v1/voters/voter-file/filters', {
      status: 200,
      data: [{ id: 42, name: 'GOTV text list' }],
    })

    render(<ListDetailSheet listId="42" onClose={vi.fn()} />)

    expect(
      await screen.findByRole('heading', { name: 'Voter list details' }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('heading', { name: 'Outreach history' }),
    ).toBeInTheDocument()
    expect(screen.getByText('Phone banking')).toBeInTheDocument()
    expect(screen.getByText('Door knocking')).toBeInTheDocument()
    expect(screen.getByText('Polls')).toBeInTheDocument()
  })

  it('reads "Constituent list details" in Serve mode', async () => {
    setContext({ isWinContext: false, isElectedOfficial: true })
    api.mock('GET /v1/voters/voter-file/filters', {
      status: 200,
      data: [{ id: 42, name: 'GOTV text list' }],
    })

    render(<ListDetailSheet listId="42" onClose={vi.fn()} />)

    expect(
      await screen.findByRole('heading', { name: 'Constituent list details' }),
    ).toBeInTheDocument()
  })

  it('suppresses the details heading until isWinContextReady settles', async () => {
    setContext({ isWinContextReady: false })
    api.mock('GET /v1/voters/voter-file/filters', {
      status: 200,
      data: [{ id: 42, name: 'GOTV text list' }],
    })

    const { rerender } = render(
      <ListDetailSheet listId="42" onClose={vi.fn()} />,
    )

    await screen.findByText('GOTV text list')
    expect(
      screen.queryByRole('heading', { name: 'Voter list details' }),
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole('heading', { name: 'Constituent list details' }),
    ).not.toBeInTheDocument()

    setContext({ isWinContextReady: true })
    rerender(<ListDetailSheet listId="42" onClose={vi.fn()} />)

    expect(
      await screen.findByRole('heading', { name: 'Voter list details' }),
    ).toBeInTheDocument()
  })
})

// ENG-10749: Serve outreach is deferred and /dashboard/outreach dead-ends
// for an eo- org, so the sheet footer's outreach CTA is Win-only. The
// Download affordance stays for both modes.
describe('ListDetailSheet — ENG-10749 footer Send outreach is Win-only', () => {
  it('shows the Send outreach footer link for Win', async () => {
    api.mock('GET /v1/voters/voter-file/filters', {
      status: 200,
      data: [{ id: 42, name: 'GOTV text list' }],
    })

    render(<ListDetailSheet listId="42" onClose={vi.fn()} />)

    // ENG-10762: the footer link carries the saved list's id so the
    // outreach page can preselect it.
    expect(
      await screen.findByRole('link', { name: 'Send outreach' }),
    ).toHaveAttribute('href', '/dashboard/outreach?listId=42')
  })

  it('hides Send outreach for Serve while keeping Download', async () => {
    setContext({ isWinContext: false, isElectedOfficial: true })
    api.mock('GET /v1/voters/voter-file/filters', {
      status: 200,
      data: [{ id: 42, name: 'GOTV text list' }],
    })

    render(<ListDetailSheet listId="42" onClose={vi.fn()} />)

    expect(
      await screen.findByRole('button', { name: 'Download list' }),
    ).toBeInTheDocument()
    expect(
      screen.queryByRole('link', { name: 'Send outreach' }),
    ).not.toBeInTheDocument()
  })

  it('renders no Send outreach while the mode is still resolving (no flash for Serve users)', async () => {
    setContext({ isWinContextReady: false })
    api.mock('GET /v1/voters/voter-file/filters', {
      status: 200,
      data: [{ id: 42, name: 'GOTV text list' }],
    })

    render(<ListDetailSheet listId="42" onClose={vi.fn()} />)

    await screen.findByText('GOTV text list')
    expect(
      screen.queryByRole('link', { name: 'Send outreach' }),
    ).not.toBeInTheDocument()
  })
})

describe('ListDetailSheet — locked-state affordance (firstUsedForOutreachAt)', () => {
  it('shows a Rename affordance for an unlocked list', async () => {
    api.mock('GET /v1/voters/voter-file/filters', {
      status: 200,
      data: [{ id: 42, name: 'GOTV text list' }],
    })

    render(<ListDetailSheet listId="42" onClose={vi.fn()} />)

    expect(
      await screen.findByRole('button', { name: 'Rename list' }),
    ).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: /duplicate to edit/i }),
    ).not.toBeInTheDocument()
  })

  it('shows "Duplicate to edit" instead of Rename once firstUsedForOutreachAt is set', async () => {
    api.mock('GET /v1/voters/voter-file/filters', {
      status: 200,
      data: [
        {
          id: 42,
          name: 'GOTV text list',
          firstUsedForOutreachAt: '2026-07-01T00:00:00.000Z',
        },
      ],
    })

    render(<ListDetailSheet listId="42" onClose={vi.fn()} />)

    expect(
      await screen.findByRole('button', { name: /duplicate to edit/i }),
    ).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Rename list' }),
    ).not.toBeInTheDocument()
  })
})

describe('ListDetailSheet — RenameListDialog (unlocked list)', () => {
  const unlockedSegment = { id: 42, name: 'GOTV text list' }

  it('rename success: PUT 200 -> success snackbar, segments invalidated, dialog closes', async () => {
    let filtersCallCount = 0
    api.mock('GET /v1/voters/voter-file/filters', () => {
      filtersCallCount += 1
      return { status: 200, data: [unlockedSegment] }
    })
    api.mock('PUT /v1/voters/voter-file/filter/:id', {
      status: 200,
      data: { id: 42, name: 'New Name' },
    })
    const user = userEvent.setup()

    render(<ListDetailSheet listId="42" onClose={vi.fn()} />)
    await user.click(await screen.findByRole('button', { name: 'Rename list' }))
    await vi.waitFor(() => expect(filtersCallCount).toBeGreaterThanOrEqual(1))
    const countBeforeSave = filtersCallCount

    const input = screen.getByLabelText('List name')
    await user.clear(input)
    await user.type(input, 'New Name')
    await user.click(screen.getByRole('button', { name: 'Save' }))

    await vi.waitFor(() =>
      expect(successSnackbar).toHaveBeenCalledWith('List renamed'),
    )
    await vi.waitFor(() =>
      expect(filtersCallCount).toBeGreaterThan(countBeforeSave),
    )
    // The sheet itself is a Radix dialog, so assert on the rename form
    // specifically rather than role='dialog'.
    expect(screen.queryByLabelText('List name')).not.toBeInTheDocument()
    expect(errorSnackbar).not.toHaveBeenCalled()
  })

  it('rename raced 409: locked-message error snackbar, invalidate, dialog closes, no generic failure toast', async () => {
    let filtersCallCount = 0
    api.mock('GET /v1/voters/voter-file/filters', () => {
      filtersCallCount += 1
      return { status: 200, data: [unlockedSegment] }
    })
    // api.mock's typed status union doesn't include 409 (the ticket's
    // documented locking edge case), so this exercises the raw mswServer
    // with an explicit HttpResponse instead of widening that union.
    mswServer.use(
      http.put('/api/v1/voters/voter-file/filter/:id', () =>
        HttpResponse.json(
          { statusCode: 409, message: LOCKED_LIST_MESSAGE, error: 'Conflict' },
          { status: 409 },
        ),
      ),
    )
    const user = userEvent.setup()

    render(<ListDetailSheet listId="42" onClose={vi.fn()} />)
    await user.click(await screen.findByRole('button', { name: 'Rename list' }))
    await vi.waitFor(() => expect(filtersCallCount).toBeGreaterThanOrEqual(1))
    const countBeforeSave = filtersCallCount

    await user.click(screen.getByRole('button', { name: 'Save' }))

    await vi.waitFor(() =>
      expect(errorSnackbar).toHaveBeenCalledWith(LOCKED_LIST_MESSAGE, {
        autoHideDuration: 6000,
      }),
    )
    await vi.waitFor(() =>
      expect(filtersCallCount).toBeGreaterThan(countBeforeSave),
    )
    expect(screen.queryByLabelText('List name')).not.toBeInTheDocument()
    expect(errorSnackbar).not.toHaveBeenCalledWith('Failed to rename list')
  })

  it('rename generic 500: error snackbar, dialog stays open', async () => {
    api.mock('GET /v1/voters/voter-file/filters', {
      status: 200,
      data: [unlockedSegment],
    })
    api.mock('PUT /v1/voters/voter-file/filter/:id', {
      status: 500,
      data: { message: 'server exploded' },
    })
    const user = userEvent.setup()

    render(<ListDetailSheet listId="42" onClose={vi.fn()} />)
    await user.click(await screen.findByRole('button', { name: 'Rename list' }))
    await user.click(screen.getByRole('button', { name: 'Save' }))

    await vi.waitFor(() =>
      expect(errorSnackbar).toHaveBeenCalledWith('Failed to rename list'),
    )
    expect(screen.getByLabelText('List name')).toBeInTheDocument()
  })
})

describe('ListDetailSheet — DeleteListDialog (unlocked list)', () => {
  const unlockedSegment = { id: 42, name: 'GOTV text list' }

  it('delete success: DELETE 200 -> success snackbar + shallow selectList(null) back to the index', async () => {
    api.mock('GET /v1/voters/voter-file/filters', {
      status: 200,
      data: [unlockedSegment],
    })
    api.mock('DELETE /v1/voters/voter-file/filter/:id', {
      status: 200,
      data: {},
    })
    const user = userEvent.setup()

    render(<ListDetailSheet listId="42" onClose={vi.fn()} />)
    await user.click(await screen.findByTestId('list-detail-delete-trigger'))
    const alertDialog = await screen.findByRole('alertdialog')
    await user.click(
      within(alertDialog).getByRole('button', { name: 'Delete' }),
    )

    await vi.waitFor(() =>
      expect(successSnackbar).toHaveBeenCalledWith('List deleted'),
    )
    await vi.waitFor(() => expect(selectList).toHaveBeenCalledWith(null))
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
  })

  it('delete raced 409: locked-message error snackbar, dialog closes, no navigation', async () => {
    api.mock('GET /v1/voters/voter-file/filters', {
      status: 200,
      data: [unlockedSegment],
    })
    mswServer.use(
      http.delete('/api/v1/voters/voter-file/filter/:id', () =>
        HttpResponse.json(
          { statusCode: 409, message: LOCKED_LIST_MESSAGE, error: 'Conflict' },
          { status: 409 },
        ),
      ),
    )
    const user = userEvent.setup()

    render(<ListDetailSheet listId="42" onClose={vi.fn()} />)
    await user.click(await screen.findByTestId('list-detail-delete-trigger'))
    const alertDialog = await screen.findByRole('alertdialog')
    await user.click(
      within(alertDialog).getByRole('button', { name: 'Delete' }),
    )

    await vi.waitFor(() =>
      expect(errorSnackbar).toHaveBeenCalledWith(LOCKED_LIST_MESSAGE, {
        autoHideDuration: 6000,
      }),
    )
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    expect(selectList).not.toHaveBeenCalled()
  })

  it('delete generic 500: error snackbar, dialog stays open, no navigation', async () => {
    api.mock('GET /v1/voters/voter-file/filters', {
      status: 200,
      data: [unlockedSegment],
    })
    api.mock('DELETE /v1/voters/voter-file/filter/:id', {
      status: 500,
      data: { message: 'server exploded' },
    })
    const user = userEvent.setup()

    render(<ListDetailSheet listId="42" onClose={vi.fn()} />)
    await user.click(await screen.findByTestId('list-detail-delete-trigger'))
    const alertDialog = await screen.findByRole('alertdialog')
    await user.click(
      within(alertDialog).getByRole('button', { name: 'Delete' }),
    )

    await vi.waitFor(() =>
      expect(errorSnackbar).toHaveBeenCalledWith('Failed to delete list'),
    )
    expect(screen.getByRole('alertdialog')).toBeInTheDocument()
    expect(selectList).not.toHaveBeenCalled()
  })
})

describe('ListDetailSheet — "Duplicate to edit" (the sole edit path for a locked list)', () => {
  const lockedSegment = {
    id: 42,
    name: 'GOTV text list',
    firstUsedForOutreachAt: '2026-07-01T00:00:00.000Z',
  }

  it('posts a copy and opens the new list on success', async () => {
    api.mock('GET /v1/voters/voter-file/filters', {
      status: 200,
      data: [lockedSegment],
    })
    let sentBody: Record<string, unknown> | null = null
    api.mock('POST /v1/voters/voter-file/filter', ({ body }) => {
      sentBody = body as Record<string, unknown>
      return {
        status: 200,
        data: { id: 555, name: 'GOTV text list (copy)' },
      }
    })
    const user = userEvent.setup()

    render(<ListDetailSheet listId="42" onClose={vi.fn()} />)

    await user.click(
      await screen.findByRole('button', { name: /duplicate to edit/i }),
    )

    await vi.waitFor(() => expect(selectList).toHaveBeenCalledWith(555))
    expect(sentBody).toMatchObject({ name: 'GOTV text list (copy)' })
    expect(successSnackbar).toHaveBeenCalledWith('List duplicated')
    expect(errorSnackbar).not.toHaveBeenCalled()
  })

  it('shows an error snackbar and does not navigate when the duplicate call fails', async () => {
    api.mock('GET /v1/voters/voter-file/filters', {
      status: 200,
      data: [lockedSegment],
    })
    api.mock('POST /v1/voters/voter-file/filter', {
      status: 500,
      data: { message: 'server exploded' },
    })
    const user = userEvent.setup()

    render(<ListDetailSheet listId="42" onClose={vi.fn()} />)

    await user.click(
      await screen.findByRole('button', { name: /duplicate to edit/i }),
    )

    await vi.waitFor(() =>
      expect(errorSnackbar).toHaveBeenCalledWith('Failed to duplicate list'),
    )
    expect(selectList).not.toHaveBeenCalled()
  })
})

describe('ListDetailSheet — not-found and error states', () => {
  it('renders a not-found message when no saved list matches the URL id', async () => {
    api.mock('GET /v1/voters/voter-file/filters', {
      status: 200,
      data: [{ id: 99, name: 'Some other list' }],
    })

    render(<ListDetailSheet listId="42" onClose={vi.fn()} />)

    expect(await screen.findByText(/couldn.t be found/i)).toBeInTheDocument()
  })

  it('renders a retry-able error message, not the not-found copy, when the filters fetch fails', async () => {
    api.mock('GET /v1/voters/voter-file/filters', {
      status: 500,
      data: { message: 'server exploded' },
    })

    render(<ListDetailSheet listId="42" onClose={vi.fn()} />)

    expect(
      await screen.findByText(/couldn.t load this list/i),
    ).toBeInTheDocument()
    expect(screen.queryByText(/may have been deleted/i)).not.toBeInTheDocument()
  })

  it('renders nothing when no list is selected (sheet closed)', () => {
    api.mock('GET /v1/voters/voter-file/filters', { status: 200, data: [] })

    render(<ListDetailSheet listId={null} onClose={vi.fn()} />)

    expect(screen.queryByText('List details')).not.toBeInTheDocument()
  })
})

// ENG-10767: sheet-open parity with the legacy Segment Viewed, the funnel
// entry click, and the rename/delete/duplicate management events.
describe('ListDetailSheet — ENG-10767 viewed + management analytics', () => {
  const unlockedSegment = { id: 42, name: 'GOTV text list' }

  it('fires Segment Viewed once when the sheet opens and the segment resolves, and again on reopen', async () => {
    api.mock('GET /v1/voters/voter-file/filters', {
      status: 200,
      data: [unlockedSegment],
    })

    const { rerender } = render(
      <ListDetailSheet listId="42" onClose={vi.fn()} />,
    )

    await vi.waitFor(() =>
      expect(eventCalls(EVENTS.Contacts.SegmentViewed)).toHaveLength(1),
    )
    expect(trackEvent).toHaveBeenCalledWith(EVENTS.Contacts.SegmentViewed, {
      segment: 'GOTV text list',
      type: 'custom',
      context: 'win',
    })

    // Close and reopen the same list — a fresh open is a fresh view.
    rerender(<ListDetailSheet listId={null} onClose={vi.fn()} />)
    rerender(<ListDetailSheet listId="42" onClose={vi.fn()} />)
    await vi.waitFor(() =>
      expect(eventCalls(EVENTS.Contacts.SegmentViewed)).toHaveLength(2),
    )
  })

  it('does not fire Segment Viewed for an unknown list id', async () => {
    api.mock('GET /v1/voters/voter-file/filters', {
      status: 200,
      data: [unlockedSegment],
    })

    render(<ListDetailSheet listId="9999" onClose={vi.fn()} />)

    expect(await screen.findByText(/couldn't be found/i)).toBeInTheDocument()
    expect(eventCalls(EVENTS.Contacts.SegmentViewed)).toHaveLength(0)
  })

  it('fires Send Outreach Clicked with surface listDetail + listId from the footer link', async () => {
    api.mock('GET /v1/voters/voter-file/filters', {
      status: 200,
      data: [unlockedSegment],
    })
    const user = userEvent.setup()

    render(<ListDetailSheet listId="42" onClose={vi.fn()} />)

    await user.click(await screen.findByRole('link', { name: 'Send outreach' }))
    expect(trackEvent).toHaveBeenCalledWith(
      EVENTS.VoterData.SendOutreachClicked,
      { listId: 42, surface: 'listDetail' },
    )
  })

  it('fires Segment Updated with action rename on a successful rename only', async () => {
    api.mock('GET /v1/voters/voter-file/filters', {
      status: 200,
      data: [unlockedSegment],
    })
    api.mock('PUT /v1/voters/voter-file/filter/:id', {
      status: 500,
      data: { message: 'server exploded' },
    })
    const user = userEvent.setup()

    render(<ListDetailSheet listId="42" onClose={vi.fn()} />)
    await user.click(await screen.findByRole('button', { name: 'Rename list' }))
    await user.click(screen.getByRole('button', { name: 'Save' }))
    await vi.waitFor(() =>
      expect(errorSnackbar).toHaveBeenCalledWith('Failed to rename list'),
    )
    // A failed rename must not report a rename.
    expect(eventCalls(EVENTS.Contacts.SegmentUpdated)).toHaveLength(0)

    api.mock('PUT /v1/voters/voter-file/filter/:id', {
      status: 200,
      data: { id: 42, name: 'New Name' },
    })
    await user.click(screen.getByRole('button', { name: 'Save' }))

    await vi.waitFor(() =>
      expect(eventCalls(EVENTS.Contacts.SegmentUpdated)).toHaveLength(1),
    )
    expect(trackEvent).toHaveBeenCalledWith(EVENTS.Contacts.SegmentUpdated, {
      action: 'rename',
      context: 'win',
    })
  })

  it('fires Segment Deleted on a successful delete (Serve context)', async () => {
    setContext({ isWinContext: false, isElectedOfficial: true })
    api.mock('GET /v1/voters/voter-file/filters', {
      status: 200,
      data: [unlockedSegment],
    })
    api.mock('DELETE /v1/voters/voter-file/filter/:id', {
      status: 200,
      data: {},
    })
    const user = userEvent.setup()

    render(<ListDetailSheet listId="42" onClose={vi.fn()} />)
    await user.click(await screen.findByTestId('list-detail-delete-trigger'))
    const alertDialog = await screen.findByRole('alertdialog')
    await user.click(
      within(alertDialog).getByRole('button', { name: 'Delete' }),
    )

    await vi.waitFor(() =>
      expect(eventCalls(EVENTS.Contacts.SegmentDeleted)).toHaveLength(1),
    )
    expect(trackEvent).toHaveBeenCalledWith(EVENTS.Contacts.SegmentDeleted, {
      context: 'serve',
    })
  })

  it('fires Segment Created with source duplicate on a successful duplicate', async () => {
    const lockedSegment = {
      id: 42,
      name: 'GOTV text list',
      firstUsedForOutreachAt: '2026-01-01T00:00:00.000Z',
    }
    api.mock('GET /v1/voters/voter-file/filters', {
      status: 200,
      data: [lockedSegment],
    })
    api.mock('POST /v1/voters/voter-file/filter', {
      status: 200,
      data: { id: 77, name: 'GOTV text list (copy)' },
    })
    const user = userEvent.setup()

    render(<ListDetailSheet listId="42" onClose={vi.fn()} />)
    await user.click(
      await screen.findByRole('button', { name: 'Duplicate to edit' }),
    )

    await vi.waitFor(() =>
      expect(eventCalls(EVENTS.Contacts.SegmentCreated)).toHaveLength(1),
    )
    expect(trackEvent).toHaveBeenCalledWith(EVENTS.Contacts.SegmentCreated, {
      source: 'duplicate',
      context: 'win',
    })
  })
})

describe('ListDetailSheet — ENG-10709 List Exported analytics', () => {
  const unlockedSegment = { id: 42, name: 'GOTV text list' }

  beforeEach(() => {
    api.mock('GET /v1/voters/voter-file/filters', {
      status: 200,
      data: [unlockedSegment],
    })
  })

  it('fires the Win-mode event with listSize only once the download confirms success, not at click time', async () => {
    let confirm: (() => void) | undefined
    downloadFn.mockImplementation((_segment, _props, onDownloadConfirmed) => {
      confirm = onDownloadConfirmed
    })
    const user = userEvent.setup()

    render(<ListDetailSheet listId="42" onClose={vi.fn()} />)
    // listSize requires the demographics query to have resolved (a click
    // before it resolves must not emit a listSize-less event) — wait on
    // avgAge's "42" as a unique signal that GET /list-detail landed, since
    // the people count "100" also matches reachability grid cells.
    await screen.findByText('42')
    await user.click(
      await screen.findByRole('button', { name: 'Download list' }),
    )

    expect(downloadFn).toHaveBeenCalledWith(
      '42',
      { context: 'win' },
      expect.any(Function),
    )
    expect(eventCalls(EVENTS.VoterData.ListExported)).toHaveLength(0)

    confirm?.()

    expect(eventCalls(EVENTS.VoterData.ListExported)).toHaveLength(1)
    expect(trackEvent).toHaveBeenCalledWith(EVENTS.VoterData.ListExported, {
      listSize: 100,
    })
  })

  it('fires the Serve-mode event on confirmed success', async () => {
    setContext({ isWinContext: false, isElectedOfficial: true })
    let confirm: (() => void) | undefined
    downloadFn.mockImplementation((_segment, _props, onDownloadConfirmed) => {
      confirm = onDownloadConfirmed
    })
    const user = userEvent.setup()

    render(<ListDetailSheet listId="42" onClose={vi.fn()} />)
    await screen.findByText('42')
    await user.click(
      await screen.findByRole('button', { name: 'Download list' }),
    )
    confirm?.()

    expect(eventCalls(EVENTS.ConstituentData.ListExported)).toHaveLength(1)
    expect(trackEvent).toHaveBeenCalledWith(
      EVENTS.ConstituentData.ListExported,
      { listSize: 100 },
    )
  })

  it('does not fire when the download confirms before the demographics count is known', async () => {
    // Overrides the beforeEach mock with one that never resolves, so
    // detailQuery.data stays undefined through the whole test — simulating a
    // confirm that lands before GET /v1/contacts/list-detail returns.
    api.mock(
      'GET /v1/contacts/list-detail',
      () => new Promise<never>(() => undefined),
    )
    let confirm: (() => void) | undefined
    downloadFn.mockImplementation((_segment, _props, onDownloadConfirmed) => {
      confirm = onDownloadConfirmed
    })
    const user = userEvent.setup()

    render(<ListDetailSheet listId="42" onClose={vi.fn()} />)
    await user.click(
      await screen.findByRole('button', { name: 'Download list' }),
    )
    confirm?.()

    expect(eventCalls(EVENTS.VoterData.ListExported)).toHaveLength(0)
  })

  it('never fires when the download hook never confirms (fallback/failure path)', async () => {
    downloadFn.mockImplementation(() => {
      // The 15s-fallback and error paths inside useContactsDownload never
      // invoke onDownloadConfirmed — simulated here by simply not calling it.
    })
    const user = userEvent.setup()

    render(<ListDetailSheet listId="42" onClose={vi.fn()} />)
    await screen.findByText('42')
    await user.click(
      await screen.findByRole('button', { name: 'Download list' }),
    )

    expect(eventCalls(EVENTS.VoterData.ListExported)).toHaveLength(0)
  })

  it('does not fire twice for two separate downloads that both confirm', async () => {
    const confirms: Array<() => void> = []
    downloadFn.mockImplementation((_segment, _props, onDownloadConfirmed) => {
      if (onDownloadConfirmed) confirms.push(onDownloadConfirmed)
    })
    const user = userEvent.setup()

    render(<ListDetailSheet listId="42" onClose={vi.fn()} />)
    await screen.findByText('42')
    const downloadButton = await screen.findByRole('button', {
      name: 'Download list',
    })
    await user.click(downloadButton)
    await user.click(downloadButton)

    confirms.forEach((confirm) => confirm())

    expect(eventCalls(EVENTS.VoterData.ListExported)).toHaveLength(2)
  })
})
