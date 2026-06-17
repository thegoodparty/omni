import { describe, it, expect, vi } from 'vitest'
import { screen } from '@testing-library/react'
import { render } from 'helpers/test-utils/render'
import ContactsPage from './ContactsPage'
import { useContactsTable } from '../hooks/ContactsTableProvider'

vi.mock('../hooks/ContactsTableProvider', () => ({
  useContactsTable: vi.fn(),
}))
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
    ...overrides,
  } as ContextValue)
}

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
