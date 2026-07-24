import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { render } from 'helpers/test-utils/render'
import { api } from 'helpers/test-utils/api-mocking'
import { EVENTS, trackEvent } from 'helpers/analyticsHelper'
import ListsIndex from './ListsIndex'
import { useContactsTable } from '../ContactsTableProvider'
import { useListRowDetail } from './useListRowDetail'
import { useDuplicateList } from './useDuplicateList'

vi.mock('../ContactsTableProvider', () => ({
  useContactsTable: vi.fn(),
}))
vi.mock('helpers/analyticsHelper', async (importOriginal) => ({
  ...(await importOriginal<typeof import('helpers/analyticsHelper')>()),
  trackEvent: vi.fn(),
}))
vi.mock('./useListRowDetail', () => ({
  useListRowDetail: vi.fn(),
}))
vi.mock('./useDuplicateList', () => ({
  useDuplicateList: vi.fn(),
}))
vi.mock('@shared/organization-picker', () => ({
  useOrganization: () => ({ slug: 'test-org' }),
}))
// Each ListCard mounts RenameListDialog/DeleteListDialog unconditionally
// (closed by default) — both call useSnackbar()/useOrganization() on every
// render regardless of `open`, so both need a mock here even though no test
// in this file exercises the dialogs' submit paths (ListDetailSheet.test.tsx
// already covers those).
vi.mock('helpers/useSnackbar', () => ({
  useSnackbar: () => ({
    successSnackbar: vi.fn(),
    errorSnackbar: vi.fn(),
    displaySnackbar: vi.fn(),
  }),
}))

const mockedUseContactsTable = vi.mocked(useContactsTable)
const mockedUseListRowDetail = vi.mocked(useListRowDetail)
const mockedUseDuplicateList = vi.mocked(useDuplicateList)

const selectList = vi.fn()

const setContext = (
  overrides: Partial<ReturnType<typeof useContactsTable>> = {},
) => {
  mockedUseContactsTable.mockReturnValue({
    customSegments: [],
    isWinContext: true,
    isWinContextReady: true,
    selectList,
    ...overrides,
  } as unknown as ReturnType<typeof useContactsTable>)
}

beforeEach(() => {
  vi.clearAllMocks()
  api.mock('GET /v1/contacts/stats', {
    status: 200,
    data: {
      districtId: 'district-1',
      computedAt: '2026-07-17T00:00:00.000Z',
      totalConstituents: 85696,
      totalConstituentsWithCellPhone: 60000,
      buckets: {
        age: [],
        homeowner: [],
        education: [],
        presenceOfChildren: [],
        estimatedIncomeRange: [],
      },
    },
  })
  mockedUseListRowDetail.mockReturnValue({
    peopleCount: 250,
    peopleCountFenced: false,
    lastOutreach: undefined,
    isLoading: false,
    isError: false,
  })
  mockedUseDuplicateList.mockReturnValue({
    mutate: vi.fn(),
    isPending: false,
  } as unknown as ReturnType<typeof useDuplicateList>)
})

describe('ListsIndex — empty state', () => {
  it('renders a message when there are no saved lists yet', () => {
    setContext({ customSegments: [] })

    render(<ListsIndex />)

    expect(
      screen.getByText(/haven.t created any lists yet/i),
    ).toBeInTheDocument()
  })

  it('reads the Win vs Serve section title/subtitle from contactsLabels', () => {
    setContext({ isWinContext: false })

    render(<ListsIndex />)

    expect(
      screen.getByRole('heading', { name: 'Constituent Lists' }),
    ).toBeInTheDocument()
  })
})

describe('ListsIndex — the "All voters" universe row', () => {
  it('renders the universe row first with the district total and no Details action', async () => {
    setContext({ customSegments: [] })

    render(<ListsIndex />)

    expect(screen.getByText('All voters')).toBeInTheDocument()
    expect(await screen.findByText('85,696')).toBeInTheDocument()
    // No saved-segment id exists for the unfiltered universe, so the row
    // offers Send outreach only.
    expect(
      screen.queryByRole('button', { name: 'Details' }),
    ).not.toBeInTheDocument()
  })

  it('reads "All constituents" in Serve mode', () => {
    setContext({ isWinContext: false })

    render(<ListsIndex />)

    expect(screen.getByText('All constituents')).toBeInTheDocument()
  })
})

// ENG-10749: Serve outreach is deferred and /dashboard/outreach dead-ends
// for an eo- org, so the outreach affordance is Win-only across the index.
describe('ListsIndex — ENG-10749 Send outreach is Win-only', () => {
  it('shows Send outreach on the universe row and each list card for Win', () => {
    setContext({ customSegments: [{ id: 42, name: 'GOTV text list' }] })

    render(<ListsIndex />)

    const outreachLinks = screen.getAllByRole('link', {
      name: 'Send outreach',
    })
    expect(outreachLinks).toHaveLength(2)
  })

  // ENG-10762: the "All voters" universe row has no saved-segment id, so
  // its link carries no listId param — only a list card's link does.
  it('carries listId on a list card link but keeps the universe row link bare', () => {
    setContext({ customSegments: [{ id: 42, name: 'GOTV text list' }] })

    render(<ListsIndex />)

    const outreachLinks = screen.getAllByRole('link', {
      name: 'Send outreach',
    })
    expect(outreachLinks[0]).toHaveAttribute('href', '/dashboard/outreach')
    expect(outreachLinks[1]).toHaveAttribute(
      'href',
      '/dashboard/outreach?listId=42',
    )
  })

  it('hides Send outreach everywhere for Serve while keeping Details, the count, and the options menu', () => {
    setContext({
      isWinContext: false,
      customSegments: [{ id: 42, name: 'Constituent list' }],
    })

    render(<ListsIndex />)

    expect(
      screen.queryByRole('link', { name: 'Send outreach' }),
    ).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Details' })).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'List options' }),
    ).toBeInTheDocument()
    expect(screen.getByText('250')).toBeInTheDocument()
  })

  it('renders no Send outreach while the mode is still resolving (no flash for Serve users)', () => {
    setContext({
      isWinContextReady: false,
      customSegments: [{ id: 42, name: 'GOTV text list' }],
    })

    render(<ListsIndex />)

    expect(
      screen.queryByRole('link', { name: 'Send outreach' }),
    ).not.toBeInTheDocument()
  })
})

// ENG-10767: the CRM list → outreach funnel entry event.
describe('ListsIndex — Send Outreach Clicked analytics', () => {
  it('fires with surface universeRow (no listId) from the universe row and surface listCard + listId from a card', async () => {
    setContext({ customSegments: [{ id: 42, name: 'GOTV text list' }] })
    const user = userEvent.setup()

    render(<ListsIndex />)

    const outreachLinks = screen.getAllByRole('link', {
      name: 'Send outreach',
    })
    await user.click(outreachLinks[0]!)
    expect(trackEvent).toHaveBeenCalledWith(
      EVENTS.VoterData.SendOutreachClicked,
      { surface: 'universeRow' },
    )

    await user.click(outreachLinks[1]!)
    expect(trackEvent).toHaveBeenCalledWith(
      EVENTS.VoterData.SendOutreachClicked,
      { listId: 42, surface: 'listCard' },
    )
  })
})

describe('ListsIndex — Details opens the detail sheet', () => {
  it('selects the list (shallow sheet navigation) when Details is clicked', async () => {
    setContext({
      customSegments: [{ id: 42, name: 'GOTV text list' }],
    })
    const user = userEvent.setup()

    render(<ListsIndex />)

    await user.click(screen.getAllByRole('button', { name: 'Details' })[0]!)

    expect(selectList).toHaveBeenCalledWith(42)
  })
})

describe('ListsIndex — card options menu', () => {
  it('shows Rename/Duplicate/Delete for an unlocked list', async () => {
    setContext({
      customSegments: [{ id: 42, name: 'GOTV text list' }],
    })
    const user = userEvent.setup()

    render(<ListsIndex />)

    await user.click(screen.getByRole('button', { name: 'List options' }))

    expect(screen.getByText('Rename')).toBeInTheDocument()
    expect(screen.getByText('Duplicate')).toBeInTheDocument()
    expect(screen.getByText('Delete')).toBeInTheDocument()
  })

  it('shows "Duplicate to edit" and hides Delete for a locked list', async () => {
    setContext({
      customSegments: [
        {
          id: 43,
          name: 'Locked list',
          firstUsedForOutreachAt: '2026-01-01T00:00:00.000Z',
        },
      ],
    })
    const user = userEvent.setup()

    render(<ListsIndex />)

    await user.click(screen.getByRole('button', { name: 'List options' }))

    expect(screen.getByText('Duplicate to edit')).toBeInTheDocument()
    expect(screen.queryByText('Rename')).not.toBeInTheDocument()
    expect(screen.queryByText('Delete')).not.toBeInTheDocument()
  })
})

// ENG-10775: people-api floors a slow count/aggregates query at FENCE_LIMIT
// (10,000) rather than finishing the exact number — the card must never
// present that floor as if it were exact.
describe('ListsIndex — fenced count affordance (ENG-10775)', () => {
  it('renders a trailing + when the count is a fenced lower bound', () => {
    mockedUseListRowDetail.mockReturnValue({
      peopleCount: 10000,
      peopleCountFenced: true,
      lastOutreach: undefined,
      isLoading: false,
      isError: false,
    })
    setContext({ customSegments: [{ id: 46, name: 'Big list' }] })

    render(<ListsIndex />)

    expect(screen.getByText('10,000+')).toBeInTheDocument()
  })

  it('renders a plain count with no + when the count is exact', () => {
    mockedUseListRowDetail.mockReturnValue({
      peopleCount: 10000,
      peopleCountFenced: false,
      lastOutreach: undefined,
      isLoading: false,
      isError: false,
    })
    setContext({ customSegments: [{ id: 47, name: 'Exactly 10k list' }] })

    render(<ListsIndex />)

    expect(screen.getByText('10,000')).toBeInTheDocument()
  })
})

describe('ListsIndex — outreach subtitle', () => {
  it('shows "No outreach yet" when the list has never been used for outreach', () => {
    mockedUseListRowDetail.mockReturnValue({
      peopleCount: 100,
      peopleCountFenced: false,
      lastOutreach: undefined,
      isLoading: false,
      isError: false,
    })
    setContext({ customSegments: [{ id: 44, name: 'Fresh list' }] })

    render(<ListsIndex />)

    expect(screen.getByText('No outreach yet')).toBeInTheDocument()
  })

  it('shows "Last outreach <date>" from outreachHistory[0] when present', () => {
    mockedUseListRowDetail.mockReturnValue({
      peopleCount: 100,
      peopleCountFenced: false,
      lastOutreach: {
        id: 9,
        name: 'GOTV blast',
        outreachType: 'text',
        status: 'completed',
        date: new Date('2026-06-22T00:00:00.000Z'),
      },
      isLoading: false,
      isError: false,
    })
    setContext({ customSegments: [{ id: 45, name: 'Texted list' }] })

    render(<ListsIndex />)

    expect(screen.getByText(/^Last outreach /)).toBeInTheDocument()
  })
})
