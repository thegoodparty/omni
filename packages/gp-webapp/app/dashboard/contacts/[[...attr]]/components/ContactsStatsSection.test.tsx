import { describe, it, expect, vi } from 'vitest'
import { screen } from '@testing-library/react'
import { render } from 'helpers/test-utils/render'
import ContactsStatsSection from './ContactsStatsSection'
import { useContactsTable } from '../../crm/ContactsTableProvider'

vi.mock('../../crm/ContactsTableProvider', () => ({
  useContactsTable: vi.fn(),
}))

const mockedUseContactsTable = vi.mocked(useContactsTable)

const setWinContext = (isWinContext: boolean) => {
  mockedUseContactsTable.mockReturnValue({
    isWinContext,
  } as ReturnType<typeof useContactsTable>)
}

describe('ContactsStatsSection — Win vs Serve naming (ENG-10448)', () => {
  it('labels the total card "Total Voters" for Win and never says constituent', () => {
    setWinContext(true)

    render(
      <ContactsStatsSection
        totalVisibleContacts={0}
        onlyTotalVisibleContacts={false}
      />,
    )

    expect(screen.getByText('Total Voters')).toBeInTheDocument()
    expect(screen.queryByText(/constituent/i)).not.toBeInTheDocument()
  })

  it('labels the total + percent cards with "Voters" for Win', () => {
    setWinContext(true)

    render(
      <ContactsStatsSection
        totalVisibleContacts={5}
        onlyTotalVisibleContacts
      />,
    )

    expect(screen.getByText('Total Voters')).toBeInTheDocument()
    expect(screen.getByText('% of Voters')).toBeInTheDocument()
  })

  it('labels the cards with "Constituents" for the Serve path', () => {
    setWinContext(false)

    render(
      <ContactsStatsSection
        totalVisibleContacts={5}
        onlyTotalVisibleContacts
      />,
    )

    expect(screen.getByText('Total Constituents')).toBeInTheDocument()
    expect(screen.getByText('% of Constituents')).toBeInTheDocument()
  })
})
