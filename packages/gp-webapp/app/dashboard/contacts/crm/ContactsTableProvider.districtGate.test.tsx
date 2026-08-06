import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import { render } from 'helpers/test-utils/render'
import { api } from 'helpers/test-utils/api-mocking'
import { CampaignContext } from '@shared/hooks/CampaignProvider'
import {
  ContactsTableProvider,
  useContactsTable,
} from './ContactsTableProvider'
import { makePerson } from './shared/test-fixtures'
import type { Organization } from 'gpApi/api-endpoints'

const districtFixture = {
  id: 'district-1',
  l2Type: 'City',
  l2Name: 'Austin',
}

const orgFixture = (district: Organization['district']): Organization => ({
  slug: 'org-one',
  name: '2026 Campaign',
  positionName: 'Mayor of Nowhere',
  position: null,
  district,
  electedOfficeId: null,
  campaignId: 1,
  status: 'active',
})

let mockOrg: Organization | undefined = orgFixture(districtFixture)
// Mutable so a test can put a person id on the path — the provider derives the
// selected person from usePathname(), not from route params.
let mockPathname = '/dashboard/contacts'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
  usePathname: () => mockPathname,
  useSearchParams: () => new URLSearchParams(),
}))

vi.mock('@shared/organization-picker', () => ({
  useOrganization: () => mockOrg,
}))

const listResponse = {
  people: [makePerson()],
  pagination: {
    totalResults: 1,
    currentPage: 1,
    pageSize: 20,
    totalPages: 1,
    hasNextPage: false,
    hasPreviousPage: false,
  },
}

// A "no request fired" assertion must not use waitFor: its callback succeeds on
// the first synchronous check at t=0, before the query could have fired, so the
// test would pass with or without the gate. Every case below waits the same
// macrotask, and the enabled counterpart proves that wait is long enough.
const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

beforeEach(() => {
  mockOrg = orgFixture(districtFixture)
  mockPathname = '/dashboard/contacts'
})

const Probe = () => {
  const { isDistrictUnresolvable, voterDataUnavailable, isLoading } =
    useContactsTable()
  return (
    <div>
      <span data-testid="loading">{String(isLoading)}</span>
      <span data-testid="unresolvable">{String(isDistrictUnresolvable)}</span>
      <span data-testid="unavailable">{String(voterDataUnavailable)}</span>
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

describe('ContactsTableProvider — district gate', () => {
  it('fires no GET /v1/contacts when the org has no resolvable district', async () => {
    const onRequest = vi.fn()
    api.mock('GET /v1/contacts', () => {
      onRequest()
      return { status: 200, data: listResponse }
    })
    mockOrg = orgFixture(null)

    renderProvider()

    await waitFor(() =>
      expect(screen.getByTestId('unavailable')).toHaveTextContent('true'),
    )
    expect(screen.getByTestId('unresolvable')).toHaveTextContent('true')
    expect(onRequest).not.toHaveBeenCalled()
  })

  it('requests normally when the org has a resolvable district', async () => {
    const onRequest = vi.fn()
    api.mock('GET /v1/contacts', () => {
      onRequest()
      return { status: 200, data: listResponse }
    })

    renderProvider()

    await waitFor(() => expect(onRequest).toHaveBeenCalled())
    expect(screen.getByTestId('unavailable')).toHaveTextContent('false')
    expect(screen.getByTestId('unresolvable')).toHaveTextContent('false')
  })

  // assertVoterDataEligibility (the federal/state voter-file rule) throws the
  // same errorCode from a district-carrying org, so the reactive path has to
  // survive alongside the proactive predicate.
  it('still reports unavailable when the server 400s despite a resolved district', async () => {
    api.mock('GET /v1/contacts', {
      status: 400,
      data: {
        message: 'Campaign is not eligible for voter data',
        errorCode: 'VOTER_DATA_UNAVAILABLE',
      },
    })

    renderProvider()

    await waitFor(() =>
      expect(screen.getByTestId('unavailable')).toHaveTextContent('true'),
    )
    expect(screen.getByTestId('unresolvable')).toHaveTextContent('false')
  })

  it('does not report unavailable while the org is still resolving', async () => {
    const onRequest = vi.fn()
    api.mock('GET /v1/contacts', () => {
      onRequest()
      return { status: 200, data: listResponse }
    })
    mockOrg = undefined

    renderProvider()

    await waitFor(() =>
      expect(screen.getByTestId('loading')).toHaveTextContent('false'),
    )
    expect(screen.getByTestId('unavailable')).toHaveTextContent('false')
  })
})

// /dashboard/contacts/<personId> is deep-linkable and PersonOverlay mounts
// outside the empty-state branch, so an unresolvable org landing on a person link
// still reached findPerson, which resolves a district server-side.
describe('ContactsTableProvider — person deep link', () => {
  const mockPerson = () => {
    const onRequest = vi.fn()
    api.mock('GET /v1/contacts/:id', () => {
      onRequest()
      return { status: 200, data: makePerson() }
    })
    api.mock('GET /v1/contacts', { status: 200, data: listResponse })
    return onRequest
  }

  it('fires the person request when a district resolves', async () => {
    const onRequest = mockPerson()
    mockPathname = '/dashboard/contacts/person-123'

    renderProvider()
    await flush()

    expect(onRequest).toHaveBeenCalled()
  })

  it('fires no person request when the district is unresolvable', async () => {
    const onRequest = mockPerson()
    mockOrg = orgFixture(null)
    mockPathname = '/dashboard/contacts/person-123'

    renderProvider()
    await flush()

    expect(onRequest).not.toHaveBeenCalled()
  })
})
