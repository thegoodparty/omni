import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'
import { render } from 'helpers/test-utils/render'
import { ContactsPageGate } from './ContactsPageGate'
import { useCrmEnabled } from '../../shared/useCrmEnabled'
import { useContactsTable } from './ContactsTableProvider'

vi.mock('../../shared/useCrmEnabled', () => ({
  useCrmEnabled: vi.fn(),
}))
vi.mock('./ContactsTableProvider', () => ({
  useContactsTable: vi.fn(),
}))
vi.mock('helpers/analyticsHelper', async (importOriginal) => ({
  ...(await importOriginal<typeof import('helpers/analyticsHelper')>()),
  trackEvent: vi.fn(),
}))
vi.mock('@shared/hooks/useCampaign', () => ({ useCampaign: () => [null] }))
vi.mock('../../shared/DashboardLayout', () => ({
  default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}))
vi.mock('app/dashboard/shared/ProUpgradeModal', () => ({
  ProUpgradeModal: () => null,
  VARIANTS: { Second_NonViable: 'second-nonviable' },
}))
vi.mock('./ContactProModal', () => ({
  ContactProModalProvider: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
}))
vi.mock('./person/PersonOverlay', () => ({ default: () => null }))
vi.mock('./ContactTypeahead', () => ({
  ContactTypeahead: () => <div data-testid="typeahead" />,
}))
vi.mock('../[[...attr]]/components/ContactSearch', () => ({
  ContactSearch: () => <div data-testid="search" />,
}))
vi.mock('../[[...attr]]/components/ContactsTable', () => ({
  default: () => <div data-testid="contacts-table" />,
}))
vi.mock('../[[...attr]]/components/segments/SegmentSection', () => ({
  default: () => <div data-testid="segment-section" />,
}))
vi.mock('../[[...attr]]/components/Download', () => ({
  default: () => <div data-testid="download" />,
}))
vi.mock('../[[...attr]]/components/ContactsStatsSection', () => ({
  default: () => <div data-testid="stats" />,
}))

const mockedUseCrmEnabled = vi.mocked(useCrmEnabled)
const mockedUseContactsTable = vi.mocked(useContactsTable)

type ContextValue = ReturnType<typeof useContactsTable>

beforeEach(() => {
  mockedUseContactsTable.mockReturnValue({
    isCustomSegment: false,
    searchTerm: '',
    totalSegmentContacts: 0,
    isVoterDataUnavailable: false,
    isWinContext: true,
    isWinContextReady: true,
  } as ContextValue)
})

describe('ContactsPageGate — whole-page CRM gate', () => {
  it('renders the old ContactsPage when the CRM flag is off', () => {
    mockedUseCrmEnabled.mockReturnValue({ enabled: false, ready: true })

    render(<ContactsPageGate />)

    expect(screen.getAllByTestId('search')).toHaveLength(2)
    expect(screen.getByTestId('contacts-table')).toBeInTheDocument()
    expect(
      screen.queryByRole('heading', { name: 'Your Voter Universe' }),
    ).not.toBeInTheDocument()
    expect(screen.queryByTestId('typeahead')).not.toBeInTheDocument()
  })

  it('renders the old ContactsPage while the flag has not settled', () => {
    mockedUseCrmEnabled.mockReturnValue({ enabled: false, ready: false })

    render(<ContactsPageGate />)

    expect(screen.getAllByTestId('search')).toHaveLength(2)
    expect(
      screen.queryByRole('heading', { name: 'Your Voter Universe' }),
    ).not.toBeInTheDocument()
  })

  it('renders only the CRM page when the flag is on: universe title + typeahead, no old table/stats', () => {
    mockedUseCrmEnabled.mockReturnValue({ enabled: true, ready: true })

    render(<ContactsPageGate />)

    expect(
      screen.getByRole('heading', { level: 1, name: 'Your Voter Universe' }),
    ).toBeInTheDocument()
    expect(screen.getByTestId('typeahead')).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Create new list' }),
    ).toBeInTheDocument()
    expect(screen.queryByTestId('search')).not.toBeInTheDocument()
    expect(screen.queryByTestId('contacts-table')).not.toBeInTheDocument()
    expect(screen.queryByTestId('stats')).not.toBeInTheDocument()
    expect(screen.queryByTestId('segment-section')).not.toBeInTheDocument()
  })

  it('reads the flag as the treatment/control divergence point (exposure tracked)', () => {
    mockedUseCrmEnabled.mockReturnValue({ enabled: false, ready: true })

    render(<ContactsPageGate />)

    expect(mockedUseCrmEnabled).toHaveBeenCalledWith(true)
  })
})
