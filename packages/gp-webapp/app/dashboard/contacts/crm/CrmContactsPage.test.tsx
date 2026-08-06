import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { render } from 'helpers/test-utils/render'
import { router } from 'helpers/test-utils/router-mocking'
import { EVENTS, trackEvent } from 'helpers/analyticsHelper'
import { CrmContactsPage } from './CrmContactsPage'
import { useContactsTable } from './ContactsTableProvider'

vi.mock('./ContactsTableProvider', () => ({
  useContactsTable: vi.fn(),
}))
vi.mock('helpers/analyticsHelper', async (importOriginal) => ({
  ...(await importOriginal<typeof import('helpers/analyticsHelper')>()),
  trackEvent: vi.fn(),
}))
const mockCampaign = vi.hoisted(() => ({
  current: null as {
    raceTargetMetrics: {
      projectedTurnout: number
      winNumber: number
    } | null
  } | null,
}))
vi.mock('@shared/hooks/useCampaign', () => ({
  useCampaign: () => [mockCampaign.current],
}))
vi.mock('../../shared/DashboardLayout', () => ({
  default: ({
    children,
    navHeader,
  }: {
    children: React.ReactNode
    navHeader?: { icon: string; label: string }
  }) => (
    <>
      {navHeader && <div data-testid="nav-header">{navHeader.label}</div>}
      {children}
    </>
  ),
}))
vi.mock('app/dashboard/shared/ProUpgradeModal', () => ({
  ProUpgradeModal: () => null,
  VARIANTS: { Second_NonViable: 'second-nonviable' },
}))
vi.mock('./person/PersonOverlay', () => ({
  default: () => <div data-testid="person-overlay" />,
}))
vi.mock('./ContactTypeahead', () => ({
  ContactTypeahead: () => <div data-testid="typeahead" />,
}))
vi.mock('./wizard/CreateListWizard', () => ({
  default: ({
    open,
    onOpenChange,
  }: {
    open: boolean
    onOpenChange: (open: boolean) => void
  }) =>
    open ? (
      <div data-testid="create-list-wizard">
        <button onClick={() => onOpenChange(false)}>close wizard</button>
      </div>
    ) : null,
}))
vi.mock('./DistrictStatCard', () => ({
  default: ({
    label,
    additionalRows,
  }: {
    label: string
    additionalRows?: Array<{ label: string; value: number }>
  }) => (
    <div data-testid="district-stat">
      <div>{label}</div>
      {additionalRows?.map((row) => (
        <div key={row.label}>{`${row.label}: ${row.value}`}</div>
      ))}
    </div>
  ),
}))
vi.mock('./assistant/CrmAssistant', () => ({
  default: () => <div data-testid="crm-assistant" />,
}))
vi.mock('./lists/ListsIndex', () => ({
  default: () => <div data-testid="lists-index" />,
}))
const mockOrganization = vi.hoisted(() => ({
  current: { slug: 'campaign-1', positionName: 'Mayor of Nowhere' } as {
    slug: string
    positionName: string | null
  } | null,
}))
vi.mock('@shared/organization-picker', () => ({
  useOrganization: () => mockOrganization.current,
}))
vi.mock('./lists/ListDetailSheet', () => ({
  default: ({
    listId,
    onClose,
  }: {
    listId: string | null
    onClose: () => void
  }) =>
    listId ? (
      <div data-testid="list-detail-sheet">
        <button data-testid="close-list-detail" onClick={onClose}>
          close
        </button>
      </div>
    ) : null,
}))

const mockedUseContactsTable = vi.mocked(useContactsTable)

type ContextValue = ReturnType<typeof useContactsTable>

const setContext = (overrides: Partial<ContextValue> = {}) => {
  mockedUseContactsTable.mockReturnValue({
    isWinContext: true,
    isWinContextReady: true,
    canUseProFeatures: true,
    customSegments: [],
    currentlySelectedListId: null,
    selectList: vi.fn(),
    ...overrides,
  } as ContextValue)
}

beforeEach(() => {
  setContext()
  mockCampaign.current = null
  mockOrganization.current = {
    slug: 'campaign-1',
    positionName: 'Mayor of Nowhere',
  }
  vi.mocked(trackEvent).mockClear()
})

// ENG-10767: parity with the pre-CRM page's Contacts Viewed (flag-on users
// vanished from that chart) — same event, distinguished by surface: 'crm'.
describe('CrmContactsPage — Contacts Viewed analytics', () => {
  it('fires once on mount with the settled context and surface crm', () => {
    const { rerender } = render(<CrmContactsPage />)

    expect(trackEvent).toHaveBeenCalledTimes(1)
    expect(trackEvent).toHaveBeenCalledWith(EVENTS.Contacts.Viewed, {
      context: 'win',
      surface: 'crm',
    })

    // A later re-render (e.g. an isWinContext revalidation flicker) must not
    // re-fire.
    setContext({ isWinContext: false })
    rerender(<CrmContactsPage />)
    expect(trackEvent).toHaveBeenCalledTimes(1)
  })

  it('waits for the Win/Serve mode to settle before firing (Serve)', () => {
    setContext({ isWinContext: false, isWinContextReady: false })
    const { rerender } = render(<CrmContactsPage />)
    expect(trackEvent).not.toHaveBeenCalled()

    setContext({ isWinContext: false, isWinContextReady: true })
    rerender(<CrmContactsPage />)
    expect(trackEvent).toHaveBeenCalledWith(EVENTS.Contacts.Viewed, {
      context: 'serve',
      surface: 'crm',
    })
  })
})

describe('CrmContactsPage — mode-aware universe title', () => {
  it('reads "Your Voter Universe" for a Win campaign and never says constituent', () => {
    setContext({ isWinContext: true })

    render(<CrmContactsPage />)

    expect(
      screen.getByRole('heading', { level: 1, name: 'Your Voter Universe' }),
    ).toBeInTheDocument()
    expect(screen.queryByText(/constituent/i)).not.toBeInTheDocument()
  })

  it('reads "Your Constituent Universe" for the Serve/elected-office path', () => {
    setContext({ isWinContext: false })

    render(<CrmContactsPage />)

    expect(
      screen.getByRole('heading', {
        level: 1,
        name: 'Your Constituent Universe',
      }),
    ).toBeInTheDocument()
  })

  it('renders no title until the Win/Serve context is ready (Win never flashes "constituent")', () => {
    setContext({ isWinContext: false, isWinContextReady: false })

    render(<CrmContactsPage />)

    expect(screen.queryByRole('heading', { level: 1 })).not.toBeInTheDocument()
    expect(screen.queryByText(/constituent/i)).not.toBeInTheDocument()
    // The button itself must be gated too, not just the copy below it — a
    // click before the mode settles could open the wizard with a
    // not-yet-resolved isWinContext (see BranchStep.tsx's own crossover fix).
    expect(
      screen.getByRole('button', { name: 'Create new list' }),
    ).toBeDisabled()
  })

  it('enables "Create new list" once the Win/Serve context is ready', () => {
    setContext({ isWinContext: true, isWinContextReady: true })

    render(<CrmContactsPage />)

    expect(
      screen.getByRole('button', { name: 'Create new list' }),
    ).toBeEnabled()
  })
})

describe('CrmContactsPage — data-title nav header (ENG-10747)', () => {
  it('reads "Voter Data" for a Win campaign', () => {
    setContext({ isWinContext: true })

    render(<CrmContactsPage />)

    expect(screen.getByTestId('nav-header')).toHaveTextContent('Voter Data')
  })

  it('reads "Constituent Data" for the Serve/elected-office path', () => {
    setContext({ isWinContext: false })

    render(<CrmContactsPage />)

    expect(screen.getByTestId('nav-header')).toHaveTextContent(
      'Constituent Data',
    )
  })

  it('renders no header until the Win/Serve context is ready (no mode-copy flash)', () => {
    setContext({ isWinContext: false, isWinContextReady: false })

    render(<CrmContactsPage />)

    expect(screen.queryByTestId('nav-header')).not.toBeInTheDocument()
  })
})

describe('CrmContactsPage — universe stat card rows (ENG-10746)', () => {
  it('Win with raceTargetMetrics passes the turnout and win-number rows', () => {
    setContext({ isWinContext: true })
    mockCampaign.current = {
      raceTargetMetrics: { projectedTurnout: 42318, winNumber: 21160 },
    }

    render(<CrmContactsPage />)

    expect(screen.getByText('Voters in your district')).toBeInTheDocument()
    expect(screen.getByText('Projected turnout: 42318')).toBeInTheDocument()
    expect(screen.getByText('Voters needed to win: 21160')).toBeInTheDocument()
  })

  it('Win without raceTargetMetrics (no P2V yet) renders only the voters row', () => {
    setContext({ isWinContext: true })
    mockCampaign.current = { raceTargetMetrics: null }

    render(<CrmContactsPage />)

    expect(screen.getByText('Voters in your district')).toBeInTheDocument()
    expect(screen.queryByText(/Projected turnout/)).not.toBeInTheDocument()
    expect(screen.queryByText(/Voters needed to win/)).not.toBeInTheDocument()
  })

  it('drops a zero-valued metric row instead of rendering "0"', () => {
    setContext({ isWinContext: true })
    mockCampaign.current = {
      raceTargetMetrics: { projectedTurnout: 0, winNumber: 21160 },
    }

    render(<CrmContactsPage />)

    expect(screen.queryByText(/Projected turnout/)).not.toBeInTheDocument()
    expect(screen.getByText('Voters needed to win: 21160')).toBeInTheDocument()
  })

  it('Serve renders the single constituents row even when a campaign has metrics', () => {
    setContext({ isWinContext: false })
    mockCampaign.current = {
      raceTargetMetrics: { projectedTurnout: 42318, winNumber: 21160 },
    }

    render(<CrmContactsPage />)

    expect(
      screen.getByText('Total constituents in your district'),
    ).toBeInTheDocument()
    expect(screen.queryByText(/Projected turnout/)).not.toBeInTheDocument()
    expect(screen.queryByText(/Voters needed to win/)).not.toBeInTheDocument()
  })
})

describe('CrmContactsPage — page contents', () => {
  it('renders the typeahead and the person overlay (selection opens the record over this page)', () => {
    render(<CrmContactsPage />)

    expect(screen.getByTestId('typeahead')).toBeInTheDocument()
    expect(screen.getByTestId('person-overlay')).toBeInTheDocument()
  })

  it('renders an enabled "Create new list" button that opens the wizard for a pro user', async () => {
    const user = userEvent.setup()
    setContext({ canUseProFeatures: true })
    render(<CrmContactsPage />)

    const button = screen.getByRole('button', { name: 'Create new list' })
    expect(button).toBeEnabled()
    expect(screen.queryByTestId('create-list-wizard')).not.toBeInTheDocument()

    await user.click(button)

    expect(router.push).not.toHaveBeenCalled()
    expect(screen.getByTestId('create-list-wizard')).toBeInTheDocument()
  })

  it('never opens the wizard for a non-pro user (Pro upgrade gate reused from the legacy create flow)', async () => {
    const user = userEvent.setup()
    setContext({ canUseProFeatures: false })
    render(<CrmContactsPage />)

    await user.click(screen.getByRole('button', { name: 'Create new list' }))

    expect(screen.queryByTestId('create-list-wizard')).not.toBeInTheDocument()
  })

  it('opens the list-detail sheet from the provider list selection and closes it via selectList(null)', async () => {
    const user = userEvent.setup()
    const selectList = vi.fn()
    setContext({ currentlySelectedListId: '42', selectList })
    render(<CrmContactsPage />)

    expect(screen.getByTestId('list-detail-sheet')).toBeInTheDocument()

    await user.click(screen.getByTestId('close-list-detail'))

    expect(selectList).toHaveBeenCalledWith(null)
  })

  it('renders no list-detail sheet when no list is selected', () => {
    setContext({ currentlySelectedListId: null })
    render(<CrmContactsPage />)

    expect(screen.queryByTestId('list-detail-sheet')).not.toBeInTheDocument()
  })
})

// The CRM page never consumed isVoterDataUnavailable, so an org with no
// resolvable district got a broken page where the legacy page showed a clean
// message. Unmounting the column is also what stops GET /v1/contacts/stats:
// DistrictStatCard and ListsIndex's AllContactsCard share the
// ['contacts-stats'] key, and React Query fires a query when ANY mounted
// observer is enabled, so enabled:false on one of them would change nothing.
describe('CrmContactsPage — voter data unavailable', () => {
  it('renders the empty state naming the office', () => {
    setContext({ voterDataUnavailable: true })

    render(<CrmContactsPage />)

    expect(
      screen.getByRole('heading', {
        name: /Voter data isn't available for this office yet/,
      }),
    ).toBeInTheDocument()
    expect(screen.getByText(/Mayor of Nowhere/)).toBeInTheDocument()
  })

  it('unmounts every surface that queries contacts data', () => {
    setContext({ voterDataUnavailable: true })

    render(<CrmContactsPage />)

    expect(screen.queryByTestId('district-stat')).not.toBeInTheDocument()
    expect(screen.queryByTestId('lists-index')).not.toBeInTheDocument()
    expect(screen.queryByTestId('typeahead')).not.toBeInTheDocument()
    expect(screen.queryByTestId('crm-assistant')).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Create new list' }),
    ).not.toBeInTheDocument()
  })

  it('keeps the nav header so the page still reads as Contacts', () => {
    setContext({ voterDataUnavailable: true })

    render(<CrmContactsPage />)

    expect(screen.getByTestId('nav-header')).toHaveTextContent('Voter Data')
  })

  it('uses Serve copy for an elected-office org', () => {
    setContext({ voterDataUnavailable: true, isWinContext: false })

    render(<CrmContactsPage />)

    expect(
      screen.getByRole('heading', {
        name: /Constituent data isn't available for this office yet/,
      }),
    ).toBeInTheDocument()
  })

  it('falls back to generic copy when the org has no office name', () => {
    setContext({ voterDataUnavailable: true })
    mockOrganization.current = { slug: 'campaign-1', positionName: null }

    render(<CrmContactsPage />)

    expect(
      screen.getByText(/match your office to a district/),
    ).toBeInTheDocument()
  })

  it('renders the normal page when voter data is available', () => {
    setContext({ voterDataUnavailable: false })

    render(<CrmContactsPage />)

    expect(screen.getByTestId('district-stat')).toBeInTheDocument()
    expect(screen.getByTestId('lists-index')).toBeInTheDocument()
    expect(screen.getByTestId('crm-assistant')).toBeInTheDocument()
    expect(
      screen.queryByText(/isn't available for this office yet/),
    ).not.toBeInTheDocument()
  })
})
