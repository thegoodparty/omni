import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { render } from 'helpers/test-utils/render'
import { router } from 'helpers/test-utils/router-mocking'
import ListsTable from './ListsTable'
import { useContactsTable } from '../ContactsTableProvider'
import { useListRowDetail } from './useListRowDetail'

vi.mock('../ContactsTableProvider', () => ({
  useContactsTable: vi.fn(),
}))
vi.mock('./useListRowDetail', () => ({
  useListRowDetail: vi.fn(),
}))

const mockedUseContactsTable = vi.mocked(useContactsTable)
const mockedUseListRowDetail = vi.mocked(useListRowDetail)

beforeEach(() => {
  vi.clearAllMocks()
  mockedUseListRowDetail.mockReturnValue({
    peopleCount: 250,
    lastOutreach: undefined,
    isLoading: false,
    isError: false,
  })
})

describe('ListsTable — empty state', () => {
  it('renders a message when there are no saved lists yet', () => {
    mockedUseContactsTable.mockReturnValue({
      customSegments: [],
    } as unknown as ReturnType<typeof useContactsTable>)

    render(<ListsTable />)

    expect(
      screen.getByText(/haven.t created any lists yet/i),
    ).toBeInTheDocument()
  })
})

describe('ListsTable — Open navigates to the detail page', () => {
  it('navigates to /dashboard/contacts/lists/:id when a row is clicked', async () => {
    mockedUseContactsTable.mockReturnValue({
      customSegments: [{ id: 42, name: 'GOTV text list' }],
    } as unknown as ReturnType<typeof useContactsTable>)
    const user = userEvent.setup()

    render(<ListsTable />)

    await user.click(screen.getByText('GOTV text list'))

    expect(router.push).toHaveBeenCalledWith('/dashboard/contacts/lists/42')
  })
})
