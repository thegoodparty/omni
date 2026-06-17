import { describe, it, expect, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import { render } from 'helpers/test-utils/render'
import { api } from 'helpers/test-utils/api-mocking'
import { CampaignContext } from '@shared/hooks/CampaignProvider'
import {
  ContactsTableProvider,
  useContactsTable,
} from './ContactsTableProvider'
import { makePerson } from '../components/shared/test-fixtures'

// The provider reads all four navigation hooks; the global setup only mocks
// useRouter/usePathname, so provide the rest here.
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
  usePathname: () => '/dashboard/contacts',
  useSearchParams: () => new URLSearchParams(),
  useParams: () => ({}),
}))

const Probe = () => {
  const { isVoterDataUnavailable, isLoading } = useContactsTable()
  return (
    <div>
      <span data-testid="loading">{String(isLoading)}</span>
      <span data-testid="unavailable">{String(isVoterDataUnavailable)}</span>
    </div>
  )
}

const renderProvider = () =>
  render(
    <CampaignContext.Provider value={[null]}>
      <ContactsTableProvider>
        <Probe />
      </ContactsTableProvider>
    </CampaignContext.Provider>,
  )

describe('ContactsTableProvider — voter-data-unavailable detection', () => {
  it('flags isVoterDataUnavailable when /v1/contacts 400s with the VOTER_DATA_UNAVAILABLE code', async () => {
    api.mock('GET /v1/contacts', {
      status: 400,
      data: {
        message:
          'Organization does not have sufficient data to resolve district',
        errorCode: 'VOTER_DATA_UNAVAILABLE',
      },
    })

    renderProvider()

    await waitFor(() =>
      expect(screen.getByTestId('unavailable')).toHaveTextContent('true'),
    )
  })

  it('does not flag isVoterDataUnavailable for an unrelated 400 error code', async () => {
    api.mock('GET /v1/contacts', {
      status: 400,
      data: { message: 'Something else', errorCode: 'SOME_OTHER_ERROR' },
    })

    renderProvider()

    await waitFor(() =>
      expect(screen.getByTestId('loading')).toHaveTextContent('false'),
    )
    expect(screen.getByTestId('unavailable')).toHaveTextContent('false')
  })

  it('does not flag isVoterDataUnavailable on a successful response', async () => {
    api.mock('GET /v1/contacts', {
      status: 200,
      data: {
        people: [makePerson()],
        pagination: {
          totalResults: 1,
          currentPage: 1,
          pageSize: 20,
          totalPages: 1,
          hasNextPage: false,
          hasPreviousPage: false,
        },
      },
    })

    renderProvider()

    await waitFor(() =>
      expect(screen.getByTestId('loading')).toHaveTextContent('false'),
    )
    expect(screen.getByTestId('unavailable')).toHaveTextContent('false')
  })
})
