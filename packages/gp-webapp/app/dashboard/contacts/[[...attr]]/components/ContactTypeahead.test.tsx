import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { render } from 'helpers/test-utils/render'
import { api } from 'helpers/test-utils/api-mocking'
import { ContactTypeahead } from './ContactTypeahead'
import { useContactsTable } from '../hooks/ContactsTableProvider'
import { useShowContactProModal } from '../hooks/ContactProModal'
import { useWinVoterContext } from '../../../shared/useWinVoterContext'
import { trackEvent } from 'helpers/analyticsHelper'
import { makePerson } from './shared/test-fixtures'
import type { ListContactsResponse, Person } from './shared/contacts-types'

vi.mock('../hooks/ContactsTableProvider', () => ({
  useContactsTable: vi.fn(),
}))
vi.mock('../hooks/ContactProModal', () => ({
  useShowContactProModal: vi.fn(),
}))
vi.mock('@shared/organization-picker', () => ({
  useOrganization: () => ({ slug: 'test-org' }),
}))
vi.mock('../../../shared/useWinVoterContext', () => ({
  useWinVoterContext: vi.fn(),
}))
vi.mock('helpers/analyticsHelper', async (importOriginal) => ({
  ...(await importOriginal<typeof import('helpers/analyticsHelper')>()),
  trackEvent: vi.fn(),
}))

const mockedUseContactsTable = vi.mocked(useContactsTable)
const mockedUseShowContactProModal = vi.mocked(useShowContactProModal)
const mockedUseWinVoterContext = vi.mocked(useWinVoterContext)
const mockedTrackEvent = vi.mocked(trackEvent)

type ContextValue = ReturnType<typeof useContactsTable>

const selectPerson = vi.fn()
const showProModal = vi.fn()

const setContext = (overrides: Partial<ContextValue> = {}) => {
  mockedUseContactsTable.mockReturnValue({
    canUseProFeatures: true,
    isWinContext: true,
    selectPerson,
    ...overrides,
  } as ContextValue)
}

const listResponse = (people: Person[]): ListContactsResponse => ({
  pagination: {
    totalResults: people.length,
    currentPage: 1,
    pageSize: 8,
    totalPages: 1,
    hasNextPage: false,
    hasPreviousPage: false,
  },
  people,
})

// Records every search term the mocked endpoint received, so tests can assert
// on request count/order (debounce, out-of-order, no-request cases).
let searches: string[]

const mockContacts = (people: Person[]) => {
  api.mock('GET /v1/contacts', ({ query }) => {
    searches.push(query.search ?? '')
    return { status: 200, data: listResponse(people) }
  })
}

const debounceSettle = () => new Promise((resolve) => setTimeout(resolve, 400))

beforeEach(() => {
  searches = []
  selectPerson.mockClear()
  showProModal.mockClear()
  mockedTrackEvent.mockClear()
  mockedUseShowContactProModal.mockReturnValue(showProModal)
  mockedUseWinVoterContext.mockReturnValue({ isWin: true, isReady: true })
  setContext()
})

describe('ContactTypeahead — query threshold and debounce', () => {
  it('renders dropdown results at 3 typed characters', async () => {
    mockContacts([makePerson()])
    const user = userEvent.setup()
    render(<ContactTypeahead />)

    await user.type(screen.getByRole('combobox'), 'Jan')

    expect(await screen.findByText('Jane Doe')).toBeInTheDocument()
    expect(screen.getByText('123 Main St, Townsville')).toBeInTheDocument()
    expect(screen.getByText(/Age 42/)).toBeInTheDocument()
  })

  it('shows no dropdown and sends no request below 3 characters', async () => {
    mockContacts([makePerson()])
    const user = userEvent.setup()
    render(<ContactTypeahead />)

    await user.type(screen.getByRole('combobox'), 'Ja')
    await debounceSettle()

    expect(searches).toEqual([])
    expect(screen.queryByText('Jane Doe')).not.toBeInTheDocument()
  })

  it('burst typing produces a single request for the final value', async () => {
    mockContacts([makePerson()])
    const user = userEvent.setup()
    render(<ContactTypeahead />)

    await user.type(screen.getByRole('combobox'), 'Janet')

    await screen.findByText('Jane Doe')
    expect(searches).toEqual(['Janet'])
  })

  it('never renders a stale slower response over a newer one', async () => {
    let releaseSlow!: () => void
    const slowGate = new Promise<void>((resolve) => {
      releaseSlow = resolve
    })
    api.mock('GET /v1/contacts', async ({ query }) => {
      searches.push(query.search ?? '')
      if (query.search === 'Ann') {
        await slowGate
        return {
          status: 200,
          data: listResponse([
            makePerson({ id: 'stale', firstName: 'Stale', lastName: 'Row' }),
          ]),
        }
      }
      return {
        status: 200,
        data: listResponse([
          makePerson({ id: 'fresh', firstName: 'Fresh', lastName: 'Row' }),
        ]),
      }
    })
    const user = userEvent.setup()
    render(<ContactTypeahead />)

    const input = screen.getByRole('combobox')
    await user.type(input, 'Ann')
    await waitFor(() => expect(searches).toContain('Ann'))

    await user.type(input, 'a')
    expect(await screen.findByText('Fresh Row')).toBeInTheDocument()

    releaseSlow()
    await debounceSettle()

    expect(screen.queryByText('Stale Row')).not.toBeInTheDocument()
    expect(screen.getByText('Fresh Row')).toBeInTheDocument()
  })

  it('shows the explicit empty state for a no-match query', async () => {
    mockContacts([])
    const user = userEvent.setup()
    render(<ContactTypeahead />)

    await user.type(screen.getByRole('combobox'), 'Zzz')

    expect(await screen.findByText('No voters found')).toBeInTheDocument()
  })

  it('shows a terminal error state instead of spinning forever when the request fails', async () => {
    api.mock('GET /v1/contacts', { status: 500, data: { message: 'boom' } })
    const user = userEvent.setup()
    render(<ContactTypeahead />)

    await user.type(screen.getByRole('combobox'), 'Jan')

    expect(
      await screen.findByText('Something went wrong. Try again.'),
    ).toBeInTheDocument()
    expect(screen.queryByText('Searching...')).not.toBeInTheDocument()
  })
})

describe('ContactTypeahead — Win vs Serve', () => {
  it('shows the party and voter copy in a Win context', async () => {
    setContext({ isWinContext: true })
    mockContacts([makePerson({ politicalParty: 'Independent' })])
    const user = userEvent.setup()
    render(<ContactTypeahead />)

    expect(
      screen.getByPlaceholderText('Search for any voter contact'),
    ).toBeInTheDocument()

    await user.type(screen.getByRole('combobox'), 'Jan')

    expect(await screen.findByText('Jane Doe')).toBeInTheDocument()
    expect(screen.getByText(/Independent/)).toBeInTheDocument()
  })

  it('hides the party and uses constituent copy in a Serve context', async () => {
    setContext({ isWinContext: false })
    mockContacts([makePerson({ politicalParty: 'Independent' })])
    const user = userEvent.setup()
    render(<ContactTypeahead />)

    expect(
      screen.getByPlaceholderText('Search for any constituent contact'),
    ).toBeInTheDocument()

    await user.type(screen.getByRole('combobox'), 'Jan')

    expect(await screen.findByText('Jane Doe')).toBeInTheDocument()
    expect(screen.queryByText(/Independent/)).not.toBeInTheDocument()
  })

  it('uses constituent wording for the Serve empty state (ENG-10448)', async () => {
    setContext({ isWinContext: false })
    mockContacts([])
    const user = userEvent.setup()
    render(<ContactTypeahead />)

    await user.type(screen.getByRole('combobox'), 'Zzz')

    expect(await screen.findByText('No constituents found')).toBeInTheDocument()
    expect(screen.queryByText(/voter/i)).not.toBeInTheDocument()
  })
})

describe('ContactTypeahead — pro gating', () => {
  it('opens the pro modal on typing and never sends a request for non-pro', async () => {
    setContext({ canUseProFeatures: false })
    mockContacts([makePerson()])
    const user = userEvent.setup()
    render(<ContactTypeahead />)

    await user.type(screen.getByRole('combobox'), 'Jan')
    await debounceSettle()

    expect(showProModal).toHaveBeenCalledWith(true)
    expect(searches).toEqual([])
    expect(screen.queryByText('Jane Doe')).not.toBeInTheDocument()
  })
})

describe('ContactTypeahead — selection and dismissal', () => {
  it('navigates to the person on click', async () => {
    mockContacts([makePerson({ id: 'p_42' })])
    const user = userEvent.setup()
    render(<ContactTypeahead />)

    await user.type(screen.getByRole('combobox'), 'Jan')
    await user.click(await screen.findByText('Jane Doe'))

    expect(selectPerson).toHaveBeenCalledWith('p_42')
    expect(screen.queryByText('Jane Doe')).not.toBeInTheDocument()
  })

  it('navigates to the highlighted person on Enter', async () => {
    mockContacts([makePerson({ id: 'p_42' })])
    const user = userEvent.setup()
    render(<ContactTypeahead />)

    await user.type(screen.getByRole('combobox'), 'Jan')
    await screen.findByText('Jane Doe')
    await user.keyboard('{Enter}')

    expect(selectPerson).toHaveBeenCalledWith('p_42')
  })

  it('closes the dropdown on Escape and reopens on the next keystroke', async () => {
    mockContacts([makePerson()])
    const user = userEvent.setup()
    render(<ContactTypeahead />)

    await user.type(screen.getByRole('combobox'), 'Jan')
    await screen.findByText('Jane Doe')

    await user.keyboard('{Escape}')
    expect(screen.queryByText('Jane Doe')).not.toBeInTheDocument()

    await user.type(screen.getByRole('combobox'), 'e')
    expect(await screen.findByText('Jane Doe')).toBeInTheDocument()
  })
})

// Event-name strings are asserted as literals on purpose: the CRM brief specs
// them exactly, so a rename in the EVENTS map must fail here.
describe('ContactTypeahead — Contact Searched analytics (ENG-10688)', () => {
  it('fires exactly one Voter Data event with resultCount for a resolved Win search', async () => {
    mockContacts([makePerson()])
    const user = userEvent.setup()
    render(<ContactTypeahead />)

    await user.type(screen.getByRole('combobox'), 'Jan')
    await screen.findByText('Jane Doe')

    await waitFor(() => expect(mockedTrackEvent).toHaveBeenCalledTimes(1))
    expect(mockedTrackEvent).toHaveBeenCalledWith(
      'Voter Data - Contact Searched',
      { resultCount: 1 },
    )
  })

  it('fires the Constituent Data event in a Serve context', async () => {
    mockedUseWinVoterContext.mockReturnValue({ isWin: false, isReady: true })
    setContext({ isWinContext: false })
    mockContacts([makePerson()])
    const user = userEvent.setup()
    render(<ContactTypeahead />)

    await user.type(screen.getByRole('combobox'), 'Jan')
    await screen.findByText('Jane Doe')

    await waitFor(() => expect(mockedTrackEvent).toHaveBeenCalledTimes(1))
    expect(mockedTrackEvent).toHaveBeenCalledWith(
      'Constituent Data - Contact Searched',
      { resultCount: 1 },
    )
  })

  it('fires with resultCount 0 for a resolved empty search', async () => {
    mockContacts([])
    const user = userEvent.setup()
    render(<ContactTypeahead />)

    await user.type(screen.getByRole('combobox'), 'Zzz')
    await screen.findByText('No voters found')

    await waitFor(() =>
      expect(mockedTrackEvent).toHaveBeenCalledWith(
        'Voter Data - Contact Searched',
        { resultCount: 0 },
      ),
    )
    expect(mockedTrackEvent).toHaveBeenCalledTimes(1)
  })

  it('does not fire for a superseded out-of-order response', async () => {
    let releaseSlow!: () => void
    const slowGate = new Promise<void>((resolve) => {
      releaseSlow = resolve
    })
    api.mock('GET /v1/contacts', async ({ query }) => {
      searches.push(query.search ?? '')
      if (query.search === 'Ann') {
        await slowGate
        return {
          status: 200,
          data: listResponse([
            makePerson({ id: 'stale-1' }),
            makePerson({ id: 'stale-2' }),
          ]),
        }
      }
      return { status: 200, data: listResponse([makePerson({ id: 'fresh' })]) }
    })
    const user = userEvent.setup()
    render(<ContactTypeahead />)

    const input = screen.getByRole('combobox')
    await user.type(input, 'Ann')
    await waitFor(() => expect(searches).toContain('Ann'))

    await user.type(input, 'a')
    await waitFor(() => expect(mockedTrackEvent).toHaveBeenCalledTimes(1))

    releaseSlow()
    await debounceSettle()

    expect(mockedTrackEvent).toHaveBeenCalledTimes(1)
    expect(mockedTrackEvent).toHaveBeenCalledWith(
      'Voter Data - Contact Searched',
      { resultCount: 1 },
    )
  })

  it('does not re-fire on re-render, but fires again for a new distinct search', async () => {
    mockContacts([makePerson()])
    const user = userEvent.setup()
    const { rerender } = render(<ContactTypeahead />)

    await user.type(screen.getByRole('combobox'), 'Jan')
    await waitFor(() => expect(mockedTrackEvent).toHaveBeenCalledTimes(1))

    rerender(<ContactTypeahead />)
    await debounceSettle()
    expect(mockedTrackEvent).toHaveBeenCalledTimes(1)

    await user.type(screen.getByRole('combobox'), 'e')
    await waitFor(() => expect(searches).toContain('Jane'))
    await waitFor(() => expect(mockedTrackEvent).toHaveBeenCalledTimes(2))
  })

  it('fires again when the same term is cleared and searched a second time', async () => {
    mockContacts([makePerson()])
    const user = userEvent.setup()
    render(<ContactTypeahead />)

    const input = screen.getByRole('combobox')
    await user.type(input, 'Jan')
    await waitFor(() => expect(mockedTrackEvent).toHaveBeenCalledTimes(1))

    await user.clear(input)
    await user.type(input, 'Jan')
    await waitFor(() => expect(mockedTrackEvent).toHaveBeenCalledTimes(2))
  })

  it('does not fire before the Win/Serve context settles, then fires once with the settled mode', async () => {
    mockedUseWinVoterContext.mockReturnValue({ isWin: false, isReady: false })
    mockContacts([makePerson()])
    const user = userEvent.setup()
    const { rerender } = render(<ContactTypeahead />)

    await user.type(screen.getByRole('combobox'), 'Jan')
    await screen.findByText('Jane Doe')
    await debounceSettle()
    expect(mockedTrackEvent).not.toHaveBeenCalled()

    mockedUseWinVoterContext.mockReturnValue({ isWin: true, isReady: true })
    rerender(<ContactTypeahead />)

    await waitFor(() => expect(mockedTrackEvent).toHaveBeenCalledTimes(1))
    expect(mockedTrackEvent).toHaveBeenCalledWith(
      'Voter Data - Contact Searched',
      { resultCount: 1 },
    )
  })

  it('does not fire for the non-pro modal path', async () => {
    setContext({ canUseProFeatures: false })
    mockContacts([makePerson()])
    const user = userEvent.setup()
    render(<ContactTypeahead />)

    await user.type(screen.getByRole('combobox'), 'Jan')
    await debounceSettle()

    expect(mockedTrackEvent).not.toHaveBeenCalled()
  })

  it('does not fire for sub-3-character input', async () => {
    mockContacts([makePerson()])
    const user = userEvent.setup()
    render(<ContactTypeahead />)

    await user.type(screen.getByRole('combobox'), 'Ja')
    await debounceSettle()

    expect(mockedTrackEvent).not.toHaveBeenCalled()
  })

  it('does not fire when the request fails', async () => {
    api.mock('GET /v1/contacts', { status: 500, data: { message: 'boom' } })
    const user = userEvent.setup()
    render(<ContactTypeahead />)

    await user.type(screen.getByRole('combobox'), 'Jan')
    await screen.findByText('Something went wrong. Try again.')

    expect(mockedTrackEvent).not.toHaveBeenCalled()
  })
})
