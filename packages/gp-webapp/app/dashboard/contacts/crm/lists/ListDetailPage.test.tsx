import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { render } from 'helpers/test-utils/render'
import { api, mswServer } from 'helpers/test-utils/api-mocking'
import { router } from 'helpers/test-utils/router-mocking'
import { useSnackbar } from 'helpers/useSnackbar'
import { EVENTS, trackEvent } from 'helpers/analyticsHelper'
import { useWinVoterContext } from '../../../shared/useWinVoterContext'
import { useContactsDownload } from '../shared/useContactsDownload'
import { LOCKED_LIST_MESSAGE } from '../shared/constants'
import ListDetailPage from './ListDetailPage'

vi.mock('@shared/organization-picker', () => ({
  useOrganization: () => ({ slug: 'test-org' }),
}))
vi.mock('@shared/hooks/useCampaign', () => ({
  useCampaign: () => [{ isPro: true }],
}))
vi.mock('@shared/hooks/useElectedOffice', () => ({
  useElectedOffice: () => ({ data: null }),
}))
vi.mock('../../../shared/useWinVoterContext', () => ({
  useWinVoterContext: vi.fn(),
}))
vi.mock('../../../shared/DashboardLayout', () => ({
  default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
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
// without them — so the "More actions" menu's Delete trigger is mocked down
// to plain elements (same approach as MoreMenu.test.tsx) rather than driving
// Radix's floating-ui positioning, which nothing else in this test suite
// exercises. Everything else in the barrel (Dialog, AlertDialog, Button, …)
// stays real, so RenameListDialog/DeleteListDialog's own interactions are
// exercised for real.
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
// from inside ListDetailPage, so the test needs one shared instance to
// assert against regardless of which internal hook fired it.
const mockedUseSnackbar = vi.mocked(useSnackbar)
const mockedUseWinVoterContext = vi.mocked(useWinVoterContext)
const mockedUseContactsDownload = vi.mocked(useContactsDownload)
const successSnackbar = vi.fn()
const errorSnackbar = vi.fn()
const downloadFn = vi.fn()

const emptyDetailResponse = {
  demographics: { people: 100, avgAge: 42, avgIncome: 65000 },
  reachability: {
    sms: 100,
    robocall: 100,
    phoneBanking: 100,
    doorKnocking: 100,
    email: null,
    metaAds: null,
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
  mockedUseWinVoterContext.mockReturnValue({ isWin: true, isReady: true })
  mockedUseContactsDownload.mockReturnValue({
    download: downloadFn,
    isPreparing: false,
  })
  api.mock('GET /v1/contacts/list-detail', {
    status: 200,
    data: emptyDetailResponse,
  })
})

describe('ListDetailPage — locked-state affordance (firstUsedForOutreachAt)', () => {
  it('shows a Rename affordance for an unlocked list', async () => {
    api.mock('GET /v1/voters/voter-file/filters', {
      status: 200,
      data: [{ id: 42, name: 'GOTV text list' }],
    })

    render(<ListDetailPage listId="42" />)

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

    render(<ListDetailPage listId="42" />)

    expect(
      await screen.findByRole('button', { name: /duplicate to edit/i }),
    ).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Rename list' }),
    ).not.toBeInTheDocument()
  })
})

describe('ListDetailPage — RenameListDialog (unlocked list)', () => {
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

    render(<ListDetailPage listId="42" />)
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
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
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

    render(<ListDetailPage listId="42" />)
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
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
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

    render(<ListDetailPage listId="42" />)
    await user.click(await screen.findByRole('button', { name: 'Rename list' }))
    await user.click(screen.getByRole('button', { name: 'Save' }))

    await vi.waitFor(() =>
      expect(errorSnackbar).toHaveBeenCalledWith('Failed to rename list'),
    )
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })
})

describe('ListDetailPage — DeleteListDialog (unlocked list)', () => {
  const unlockedSegment = { id: 42, name: 'GOTV text list' }

  it('delete success: DELETE 200 -> success snackbar + router.push to the index', async () => {
    api.mock('GET /v1/voters/voter-file/filters', {
      status: 200,
      data: [unlockedSegment],
    })
    api.mock('DELETE /v1/voters/voter-file/filter/:id', {
      status: 200,
      data: {},
    })
    const user = userEvent.setup()

    render(<ListDetailPage listId="42" />)
    await user.click(await screen.findByTestId('list-detail-delete-trigger'))
    const alertDialog = await screen.findByRole('alertdialog')
    await user.click(
      within(alertDialog).getByRole('button', { name: 'Delete' }),
    )

    await vi.waitFor(() =>
      expect(successSnackbar).toHaveBeenCalledWith('List deleted'),
    )
    await vi.waitFor(() =>
      expect(router.push).toHaveBeenCalledWith('/dashboard/contacts'),
    )
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
  })

  it('delete raced 409: locked-message error snackbar, invalidate, dialog closes, no navigation', async () => {
    let filtersCallCount = 0
    api.mock('GET /v1/voters/voter-file/filters', () => {
      filtersCallCount += 1
      return { status: 200, data: [unlockedSegment] }
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

    render(<ListDetailPage listId="42" />)
    await user.click(await screen.findByTestId('list-detail-delete-trigger'))
    await vi.waitFor(() => expect(filtersCallCount).toBeGreaterThanOrEqual(1))
    const countBeforeDelete = filtersCallCount
    const alertDialog = await screen.findByRole('alertdialog')
    await user.click(
      within(alertDialog).getByRole('button', { name: 'Delete' }),
    )

    await vi.waitFor(() =>
      expect(errorSnackbar).toHaveBeenCalledWith(LOCKED_LIST_MESSAGE, {
        autoHideDuration: 6000,
      }),
    )
    await vi.waitFor(() =>
      expect(filtersCallCount).toBeGreaterThan(countBeforeDelete),
    )
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    expect(router.push).not.toHaveBeenCalled()
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

    render(<ListDetailPage listId="42" />)
    await user.click(await screen.findByTestId('list-detail-delete-trigger'))
    const alertDialog = await screen.findByRole('alertdialog')
    await user.click(
      within(alertDialog).getByRole('button', { name: 'Delete' }),
    )

    await vi.waitFor(() =>
      expect(errorSnackbar).toHaveBeenCalledWith('Failed to delete list'),
    )
    expect(screen.getByRole('alertdialog')).toBeInTheDocument()
    expect(router.push).not.toHaveBeenCalled()
  })
})

describe('ListDetailPage — "Duplicate to edit" (the sole edit path for a locked list)', () => {
  const lockedSegment = {
    id: 42,
    name: 'GOTV text list',
    firstUsedForOutreachAt: '2026-07-01T00:00:00.000Z',
  }

  it('posts a copy and navigates to the new list on success', async () => {
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

    render(<ListDetailPage listId="42" />)

    await user.click(
      await screen.findByRole('button', { name: /duplicate to edit/i }),
    )

    await vi.waitFor(() =>
      expect(router.push).toHaveBeenCalledWith('/dashboard/contacts/lists/555'),
    )
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

    render(<ListDetailPage listId="42" />)

    await user.click(
      await screen.findByRole('button', { name: /duplicate to edit/i }),
    )

    await vi.waitFor(() =>
      expect(errorSnackbar).toHaveBeenCalledWith('Failed to duplicate list'),
    )
    expect(router.push).not.toHaveBeenCalled()
  })
})

describe('ListDetailPage — not-found state', () => {
  it('renders a not-found message when no saved list matches the URL id', async () => {
    api.mock('GET /v1/voters/voter-file/filters', {
      status: 200,
      data: [{ id: 99, name: 'Some other list' }],
    })

    render(<ListDetailPage listId="42" />)

    expect(await screen.findByText(/couldn.t be found/i)).toBeInTheDocument()
  })
})

describe('ListDetailPage — segments-fetch error state', () => {
  it('renders a retry-able error message, not the not-found copy, when the filters fetch fails', async () => {
    api.mock('GET /v1/voters/voter-file/filters', {
      status: 500,
      data: { message: 'server exploded' },
    })

    render(<ListDetailPage listId="42" />)

    expect(
      await screen.findByText(/couldn.t load this list/i),
    ).toBeInTheDocument()
    expect(screen.queryByText(/may have been deleted/i)).not.toBeInTheDocument()
  })
})

describe('ListDetailPage — ENG-10709 List Exported analytics', () => {
  const unlockedSegment = { id: 42, name: 'GOTV text list' }

  beforeEach(() => {
    api.mock('GET /v1/voters/voter-file/filters', {
      status: 200,
      data: [unlockedSegment],
    })
  })

  it('fires the Win-mode event with listSize only once the download confirms success, not at click time', async () => {
    mockedUseWinVoterContext.mockReturnValue({ isWin: true, isReady: true })
    let confirm: (() => void) | undefined
    downloadFn.mockImplementation((_segment, _props, onDownloadConfirmed) => {
      confirm = onDownloadConfirmed
    })
    const user = userEvent.setup()

    render(<ListDetailPage listId="42" />)
    // listSize now requires the demographics query to have resolved (a
    // click before it resolves must not emit a listSize-less event) — wait
    // on avgAge's "42" as a unique signal that GET /list-detail landed,
    // since the people count "100" also matches reachability grid cells.
    await screen.findByText('42')
    await user.click(await screen.findByRole('button', { name: 'Download' }))

    expect(downloadFn).toHaveBeenCalledWith(
      '42',
      { context: 'win' },
      expect.any(Function),
    )
    expect(trackEvent).not.toHaveBeenCalled()

    confirm?.()

    expect(trackEvent).toHaveBeenCalledTimes(1)
    expect(trackEvent).toHaveBeenCalledWith(EVENTS.VoterData.ListExported, {
      listSize: 100,
    })
  })

  it('fires the Serve-mode event on confirmed success', async () => {
    mockedUseWinVoterContext.mockReturnValue({ isWin: false, isReady: true })
    let confirm: (() => void) | undefined
    downloadFn.mockImplementation((_segment, _props, onDownloadConfirmed) => {
      confirm = onDownloadConfirmed
    })
    const user = userEvent.setup()

    render(<ListDetailPage listId="42" />)
    await screen.findByText('42')
    await user.click(await screen.findByRole('button', { name: 'Download' }))
    confirm?.()

    expect(trackEvent).toHaveBeenCalledTimes(1)
    expect(trackEvent).toHaveBeenCalledWith(
      EVENTS.ConstituentData.ListExported,
      { listSize: 100 },
    )
  })

  it('never fires when the download hook never confirms (fallback/failure path)', async () => {
    downloadFn.mockImplementation(() => {
      // The 15s-fallback and error paths inside useContactsDownload never
      // invoke onDownloadConfirmed — simulated here by simply not calling it.
    })
    const user = userEvent.setup()

    render(<ListDetailPage listId="42" />)
    await screen.findByText('42')
    await user.click(await screen.findByRole('button', { name: 'Download' }))

    expect(trackEvent).not.toHaveBeenCalled()
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

    render(<ListDetailPage listId="42" />)
    await user.click(await screen.findByRole('button', { name: 'Download' }))
    confirm?.()

    expect(trackEvent).not.toHaveBeenCalled()
  })

  it('does not fire twice for two separate downloads that both confirm', async () => {
    const confirms: Array<() => void> = []
    downloadFn.mockImplementation((_segment, _props, onDownloadConfirmed) => {
      if (onDownloadConfirmed) confirms.push(onDownloadConfirmed)
    })
    const user = userEvent.setup()

    render(<ListDetailPage listId="42" />)
    await screen.findByText('42')
    const downloadButton = await screen.findByRole('button', {
      name: 'Download',
    })
    await user.click(downloadButton)
    await user.click(downloadButton)

    confirms.forEach((confirm) => confirm())

    expect(trackEvent).toHaveBeenCalledTimes(2)
  })
})
