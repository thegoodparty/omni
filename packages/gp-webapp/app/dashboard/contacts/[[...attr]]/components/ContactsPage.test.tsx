import { beforeEach, describe, it, expect, vi } from 'vitest'
import { screen } from '@testing-library/react'
import { render } from 'helpers/test-utils/render'
import ContactsPage from './ContactsPage'
import { useContactsTable } from '../hooks/ContactsTableProvider'
import { EVENTS, trackEvent } from 'helpers/analyticsHelper'

vi.mock('../hooks/ContactsTableProvider', () => ({
  useContactsTable: vi.fn(),
}))
vi.mock('helpers/analyticsHelper', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('helpers/analyticsHelper')>()
  return { ...actual, trackEvent: vi.fn() }
})
vi.mock('@shared/hooks/useCampaign', () => ({ useCampaign: () => [null] }))
vi.mock('../../../shared/DashboardLayout', () => ({
  default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}))
vi.mock('../hooks/ContactProModal', () => ({
  ContactProModalProvider: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
}))
vi.mock('app/dashboard/shared/ProUpgradeModal', () => ({
  ProUpgradeModal: () => null,
  VARIANTS: { Second_NonViable: 'second-nonviable' },
}))
vi.mock('./person/PersonOverlay', () => ({ default: () => null }))
vi.mock('./ContactsTable', () => ({
  default: () => <div data-testid="contacts-table" />,
}))
vi.mock('./segments/SegmentSection', () => ({
  default: () => <div data-testid="segment-section" />,
}))
vi.mock('./Download', () => ({ default: () => <div data-testid="download" /> }))
vi.mock('./ContactsStatsSection', () => ({
  default: () => <div data-testid="stats" />,
}))
vi.mock('./ContactSearch', () => ({
  ContactSearch: () => <div data-testid="search" />,
}))

const mockedUseContactsTable = vi.mocked(useContactsTable)

type ContextValue = ReturnType<typeof useContactsTable>

const setContext = (overrides: Partial<ContextValue>) => {
  mockedUseContactsTable.mockReturnValue({
    isCustomSegment: false,
    searchTerm: '',
    totalSegmentContacts: 0,
    isVoterDataUnavailable: false,
    isWinContext: false,
    isElectedOfficeLoading: false,
    ...overrides,
  } as ContextValue)
}

describe('ContactsPage — Contacts Viewed analytics', () => {
  beforeEach(() => {
    vi.mocked(trackEvent).mockClear()
  })

  it('fires Contacts Viewed once with win context for a Win campaign', () => {
    setContext({ isWinContext: true })

    render(<ContactsPage />)

    expect(trackEvent).toHaveBeenCalledTimes(1)
    expect(trackEvent).toHaveBeenCalledWith(EVENTS.Contacts.Viewed, {
      context: 'win',
    })
  })

  it('fires Contacts Viewed once with serve context for an elected official', () => {
    setContext({ isWinContext: false })

    render(<ContactsPage />)

    expect(trackEvent).toHaveBeenCalledTimes(1)
    expect(trackEvent).toHaveBeenCalledWith(EVENTS.Contacts.Viewed, {
      context: 'serve',
    })
  })

  it('does not fire while the elected-office query is loading', () => {
    setContext({ isWinContext: false, isElectedOfficeLoading: true })

    render(<ContactsPage />)

    expect(trackEvent).not.toHaveBeenCalled()
  })

  it('fires once with win context after loading settles, with no spurious serve event', () => {
    // Reproduces the production sequence for a Win user: isWinContext is false
    // while isElectedOfficeLoading is true, then both flip once the query
    // settles. The event must fire exactly once, with win — never a serve event
    // on the loading render.
    setContext({ isWinContext: false, isElectedOfficeLoading: true })

    const { rerender } = render(<ContactsPage />)
    expect(trackEvent).not.toHaveBeenCalled()

    setContext({ isWinContext: true, isElectedOfficeLoading: false })
    rerender(<ContactsPage />)

    expect(trackEvent).toHaveBeenCalledTimes(1)
    expect(trackEvent).toHaveBeenCalledWith(EVENTS.Contacts.Viewed, {
      context: 'win',
    })
  })
})

describe('ContactsPage — ineligible (voter data unavailable) state', () => {
  it('renders the ineligible message and hides the table when voter data is unavailable', () => {
    setContext({ isVoterDataUnavailable: true })

    render(<ContactsPage />)

    expect(
      screen.getByText('Voter data not available for your district'),
    ).toBeInTheDocument()
    expect(screen.queryByTestId('contacts-table')).not.toBeInTheDocument()
    expect(screen.queryByTestId('segment-section')).not.toBeInTheDocument()
  })

  it('renders the contacts table when voter data is available', () => {
    setContext({ isVoterDataUnavailable: false })

    render(<ContactsPage />)

    expect(screen.getByTestId('contacts-table')).toBeInTheDocument()
    expect(
      screen.queryByText('Voter data not available for your district'),
    ).not.toBeInTheDocument()
  })
})
