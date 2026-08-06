import { beforeEach, describe, it, expect, vi } from 'vitest'
import { screen } from '@testing-library/react'
import { render } from 'helpers/test-utils/render'
import ContactsPage from './ContactsPage'
import { useContactsTable } from '../../crm/ContactsTableProvider'
import { EVENTS, trackEvent } from 'helpers/analyticsHelper'

vi.mock('../../crm/ContactsTableProvider', () => ({
  useContactsTable: vi.fn(),
}))
vi.mock('helpers/analyticsHelper', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('helpers/analyticsHelper')>()
  return { ...actual, trackEvent: vi.fn() }
})
vi.mock('@shared/hooks/useCampaign', () => ({ useCampaign: () => [null] }))
vi.mock('../../../shared/DashboardLayout', () => ({
  default: ({
    children,
    navHeader,
  }: {
    children: React.ReactNode
    navHeader?: { label: string }
  }) => (
    <>
      {navHeader && <h1>{navHeader.label}</h1>}
      {children}
    </>
  ),
}))
vi.mock('../../crm/ContactProModal', () => ({
  ContactProModalProvider: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
}))
vi.mock('app/dashboard/shared/ProUpgradeModal', () => ({
  ProUpgradeModal: () => null,
  VARIANTS: { Second_NonViable: 'second-nonviable' },
}))
vi.mock('../../crm/person/PersonOverlay', () => ({ default: () => null }))
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
    isDistrictUnresolvable: false,
    voterDataUnavailable: false,
    isWinContext: false,
    isWinContextReady: true,
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

  it('does not fire while the win context is not yet ready', () => {
    setContext({ isWinContext: false, isWinContextReady: false })

    render(<ContactsPage />)

    expect(trackEvent).not.toHaveBeenCalled()
  })

  it('fires once with win context after readiness settles, with no spurious serve event', () => {
    // Reproduces the production sequence for a Win user: isWinContext reads
    // false while isWinContextReady is false (elected-office query still
    // resolving), then both flip once everything settles. The event must fire exactly once, with win — never a serve event
    // on the not-ready render.
    setContext({ isWinContext: false, isWinContextReady: false })

    const { rerender } = render(<ContactsPage />)
    expect(trackEvent).not.toHaveBeenCalled()

    setContext({ isWinContext: true, isWinContextReady: true })
    rerender(<ContactsPage />)

    expect(trackEvent).toHaveBeenCalledTimes(1)
    expect(trackEvent).toHaveBeenCalledWith(EVENTS.Contacts.Viewed, {
      context: 'win',
    })
  })

  it('fires exactly once across the readiness transition, even if isWinContext toggles afterward', () => {
    // Drive the component THROUGH the intermediate { isWinContext: false,
    // isWinContextReady: true } state the production race actually produces:
    // readiness settles while isWinContext is still false, then a later
    // flag re-fetch / focus revalidation flips isWinContext to true. The
    // ref latch must fire once on the first ready render and stay silent on
    // the subsequent toggle. Without the guard, the toggle would re-fire.
    setContext({ isWinContext: false, isWinContextReady: false })

    const { rerender } = render(<ContactsPage />)
    expect(trackEvent).not.toHaveBeenCalled()

    // Intermediate state: ready, but isWinContext has not flipped yet.
    setContext({ isWinContext: false, isWinContextReady: true })
    rerender(<ContactsPage />)

    expect(trackEvent).toHaveBeenCalledTimes(1)
    expect(trackEvent).toHaveBeenCalledWith(EVENTS.Contacts.Viewed, {
      context: 'serve',
    })

    // Later toggle (flag re-fetch / focus revalidation): must not re-fire.
    setContext({ isWinContext: true, isWinContextReady: true })
    rerender(<ContactsPage />)

    expect(trackEvent).toHaveBeenCalledTimes(1)
  })
})

describe('ContactsPage — Win vs Serve naming (ENG-10448)', () => {
  it('reads "Voter Data" for a Win campaign and never says constituent', () => {
    setContext({ isWinContext: true })

    render(<ContactsPage />)

    expect(
      screen.getByRole('heading', { level: 1, name: 'Voter Data' }),
    ).toBeInTheDocument()
    expect(
      screen.getByText('Manage and filter on your voter list'),
    ).toBeInTheDocument()
    expect(screen.queryByText(/constituent/i)).not.toBeInTheDocument()
  })

  it('reads "Constituent Data" for the Serve/elected-office path', () => {
    setContext({ isWinContext: false })

    render(<ContactsPage />)

    // Serve shows the title in the full-bleed nav header (an <h1>), replacing
    // the in-page heading so it isn't duplicated.
    expect(
      screen.getByRole('heading', { level: 1, name: 'Constituent Data' }),
    ).toBeInTheDocument()
    expect(
      screen.getByText('Manage and filter on your constituent list'),
    ).toBeInTheDocument()
  })

  it('renders no Win/Serve label until the context is ready (Win never flashes "constituent")', () => {
    // Before readiness isWinContext reads false, which would otherwise pick the
    // Serve copy and leak "constituent" to a Win user mid-load. Suppress it.
    setContext({ isWinContext: false, isWinContextReady: false })

    render(<ContactsPage />)

    expect(screen.queryByRole('heading', { level: 1 })).not.toBeInTheDocument()
    expect(screen.queryByText(/constituent/i)).not.toBeInTheDocument()
  })
})

describe('ContactsPage — table search', () => {
  it('always renders ContactSearch at both render sites (desktop + mobile)', () => {
    // The CRM flag no longer touches this page: flag-on users get the whole
    // CrmContactsPage via ContactsPageGate, and this page stays byte-equivalent
    // to its pre-typeahead behavior for everyone else.
    setContext({})

    render(<ContactsPage />)

    expect(screen.getAllByTestId('search')).toHaveLength(2)
  })
})

describe('ContactsPage — ineligible (voter data unavailable) state', () => {
  // The reactive path (assertVoterDataEligibility 400s from a district-carrying
  // org). The provider derives voterDataUnavailable as the union, so a fixture
  // setting only the reactive flag would express a state it can never produce.
  it('renders the ineligible message and hides the table when voter data is unavailable', () => {
    setContext({ isVoterDataUnavailable: true, voterDataUnavailable: true })

    render(<ContactsPage />)

    expect(
      screen.getByText('Voter data not available for your district'),
    ).toBeInTheDocument()
    expect(screen.queryByTestId('contacts-table')).not.toBeInTheDocument()
    expect(screen.queryByTestId('segment-section')).not.toBeInTheDocument()
  })

  it('renders the contacts table when voter data is available', () => {
    setContext({
      isVoterDataUnavailable: false,
      isDistrictUnresolvable: false,
      voterDataUnavailable: false,
    })

    render(<ContactsPage />)

    expect(screen.getByTestId('contacts-table')).toBeInTheDocument()
    expect(
      screen.queryByText('Voter data not available for your district'),
    ).not.toBeInTheDocument()
  })

  // The proactive predicate gates the contacts query, so the 400 that used to
  // set isVoterDataUnavailable never happens. Reading the reactive flag alone
  // would render the normal layout here — and ContactsStatsSection would then
  // fire GET /v1/contacts/stats and 400.
  it('renders the ineligible message from the proactive predicate alone', () => {
    setContext({
      isVoterDataUnavailable: false,
      isDistrictUnresolvable: true,
      voterDataUnavailable: true,
    })

    render(<ContactsPage />)

    expect(
      screen.getByText('Voter data not available for your district'),
    ).toBeInTheDocument()
    expect(screen.queryByTestId('contacts-table')).not.toBeInTheDocument()
    expect(screen.queryByTestId('stats')).not.toBeInTheDocument()
  })
})
