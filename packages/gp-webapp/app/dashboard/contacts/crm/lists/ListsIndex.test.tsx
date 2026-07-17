import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { render } from 'helpers/test-utils/render'
import { router } from 'helpers/test-utils/router-mocking'
import ListsIndex from './ListsIndex'
import { useContactsTable } from '../ContactsTableProvider'
import { useListRowDetail } from './useListRowDetail'
import { useDuplicateList } from './useDuplicateList'

vi.mock('../ContactsTableProvider', () => ({
  useContactsTable: vi.fn(),
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
// in this file exercises the dialogs' submit paths (ListDetailPage.test.tsx
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

const setContext = (
  overrides: Partial<ReturnType<typeof useContactsTable>> = {},
) => {
  mockedUseContactsTable.mockReturnValue({
    customSegments: [],
    isWinContext: true,
    ...overrides,
  } as unknown as ReturnType<typeof useContactsTable>)
}

beforeEach(() => {
  vi.clearAllMocks()
  mockedUseListRowDetail.mockReturnValue({
    peopleCount: 250,
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

describe('ListsIndex — Details navigates to the detail page', () => {
  it('navigates to /dashboard/contacts/lists/:id when Details is clicked', async () => {
    setContext({
      customSegments: [{ id: 42, name: 'GOTV text list' }],
    })
    const user = userEvent.setup()

    render(<ListsIndex />)

    await user.click(screen.getAllByRole('button', { name: 'Details' })[0]!)

    expect(router.push).toHaveBeenCalledWith('/dashboard/contacts/lists/42')
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

describe('ListsIndex — outreach subtitle', () => {
  it('shows "No outreach yet" when the list has never been used for outreach', () => {
    mockedUseListRowDetail.mockReturnValue({
      peopleCount: 100,
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
