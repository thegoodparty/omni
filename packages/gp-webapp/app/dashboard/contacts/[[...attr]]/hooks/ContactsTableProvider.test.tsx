import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import { render } from 'helpers/test-utils/render'
import { api } from 'helpers/test-utils/api-mocking'
import { CampaignContext } from '@shared/hooks/CampaignProvider'
import { useWinVoterDataFlag } from '@shared/experiments/winVoterDataFlag'
import {
  ContactsTableProvider,
  useContactsTable,
} from './ContactsTableProvider'
import { makePerson } from '../components/shared/test-fixtures'
import type { ElectedOffice } from 'gpApi/api-endpoints'

const electedOfficeFixture: ElectedOffice = {
  id: 'eo_1',
  swornInDate: null,
  electedDate: null,
  termStartDate: null,
  termEndDate: null,
  termLengthDays: null,
  isActive: true,
  party: null,
  pledgedAt: null,
  onboardingCompletedAt: null,
  selfReported: false,
  onboardingStep: null,
}

// The provider reads all four navigation hooks; the global setup only mocks
// useRouter/usePathname, so provide the rest here. params is mutable so a test
// can select a person (drives the engagement queries).
let mockParams: Record<string, string | string[]> = {}
let mockPush = vi.fn()

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush }),
  usePathname: () => '/dashboard/contacts',
  useSearchParams: () => new URLSearchParams(),
  useParams: () => mockParams,
}))

vi.mock('@shared/experiments/winVoterDataFlag', () => ({
  useWinVoterDataFlag: vi.fn(),
}))

// The provider and useElectedOffice both read the active org from here to
// org-scope their query keys (ENG-10511); outside a provider it would throw.
vi.mock('@shared/organization-picker', () => ({
  useOrganization: () => ({ slug: 'org-one' }),
}))

const mockedUseWinVoterDataFlag = vi.mocked(useWinVoterDataFlag)

beforeEach(() => {
  mockParams = {}
  mockPush = vi.fn()
  mockedUseWinVoterDataFlag.mockReset()
  mockedUseWinVoterDataFlag.mockReturnValue({ ready: true, enabled: false })
})

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

describe('ContactsTableProvider — engagement :id selection', () => {
  const mockContactsList = () =>
    api.mock('GET /v1/contacts', {
      status: 200,
      data: {
        people: [],
        pagination: {
          totalResults: 0,
          currentPage: 1,
          pageSize: 20,
          totalPages: 1,
          hasNextPage: false,
          hasPreviousPage: false,
        },
      },
    })

  it('passes person.lalVoterId (not person.id) for the Win activities branch', async () => {
    mockParams = { attr: ['p_1'] }
    mockedUseWinVoterDataFlag.mockReturnValue({ ready: true, enabled: true })
    mockContactsList()
    // No elected office -> Win context.
    api.mock('GET /v1/elected-office/current', {
      status: 404,
      data: { message: 'not found' },
    })
    api.mock('GET /v1/contacts/:id', {
      status: 200,
      data: makePerson({ id: 'p_1', lalVoterId: 'lal_1' }),
    })

    let capturedId: string | undefined
    api.mock('GET /v1/contact-engagement/:id/activities', (request) => {
      capturedId = request.params.id
      return { status: 200, data: { nextCursor: null, results: [] } }
    })

    renderProvider()

    await waitFor(() => expect(capturedId).toBe('lal_1'))
  })

  it('passes person.id for the Serve (elected office) activities branch', async () => {
    mockParams = { attr: ['p_1'] }
    mockedUseWinVoterDataFlag.mockReturnValue({ ready: true, enabled: false })
    mockContactsList()
    api.mock('GET /v1/elected-office/current', {
      status: 200,
      data: electedOfficeFixture,
    })
    api.mock('GET /v1/contacts/:id', {
      status: 200,
      data: makePerson({ id: 'p_1', lalVoterId: 'lal_1' }),
    })

    let capturedId: string | undefined
    api.mock('GET /v1/contact-engagement/:id/activities', (request) => {
      capturedId = request.params.id
      return { status: 200, data: { nextCursor: null, results: [] } }
    })

    renderProvider()

    await waitFor(() => expect(capturedId).toBe('p_1'))
  })

  it('never fires the Win-keyed lalVoterId request for an elected official while the flag is on (loading-window guard)', async () => {
    mockParams = { attr: ['p_1'] }
    mockedUseWinVoterDataFlag.mockReturnValue({ ready: true, enabled: true })
    mockContactsList()
    // Delay the elected-office resolution so the person fetch (with its
    // lalVoterId) settles first, recreating the loading window where
    // `electedOffice` is still undefined for a Serve user. Without the
    // isElectedOfficeLoading guard, isWinContext would be true here and a
    // lal_1 request would fire against the wrong endpoint.
    api.mock('GET /v1/elected-office/current', async () => {
      await new Promise((resolve) => setTimeout(resolve, 50))
      return { status: 200, data: electedOfficeFixture }
    })
    api.mock('GET /v1/contacts/:id', {
      status: 200,
      data: makePerson({ id: 'p_1', lalVoterId: 'lal_1' }),
    })

    const capturedIds: string[] = []
    api.mock('GET /v1/contact-engagement/:id/activities', (request) => {
      capturedIds.push(request.params.id)
      return { status: 200, data: { nextCursor: null, results: [] } }
    })

    renderProvider()

    await waitFor(() => expect(capturedIds).toContain('p_1'))
    expect(capturedIds).not.toContain('lal_1')
  })
})

describe('ContactsTableProvider — selectSegment re-applies a saved search', () => {
  const mockContactsList = () =>
    api.mock('GET /v1/contacts', {
      status: 200,
      data: {
        people: [],
        pagination: {
          totalResults: 0,
          currentPage: 1,
          pageSize: 20,
          totalPages: 1,
          hasNextPage: false,
          hasPreviousPage: false,
        },
      },
    })

  // Selecting a saved list created from a search must re-issue the contacts
  // query with that search (ENG-10518). The provider drives this through the
  // URL `query` param, so assert what it pushes to the router.
  const SelectProbe = ({ segmentId }: { segmentId: string }) => {
    const { selectSegment, customSegments } = useContactsTable()
    return (
      <button
        data-testid="select"
        data-loaded={String(customSegments.length > 0)}
        onClick={() => selectSegment(segmentId)}
      >
        select
      </button>
    )
  }

  const renderSelectProbe = (segmentId: string) =>
    render(
      <CampaignContext.Provider value={[null]}>
        <ContactsTableProvider>
          <SelectProbe segmentId={segmentId} />
        </ContactsTableProvider>
      </CampaignContext.Provider>,
    )

  it('puts the saved list search into the query param when the list is selected', async () => {
    mockContactsList()
    api.mock('GET /v1/voters/voter-file/filters', {
      status: 200,
      data: [{ id: 55, name: 'Smith voters', search: 'smith' }],
    })

    renderSelectProbe('55')

    const button = await screen.findByTestId('select')
    await waitFor(() => expect(button).toHaveAttribute('data-loaded', 'true'))
    button.click()

    await waitFor(() => expect(mockPush).toHaveBeenCalled())
    const pushedUrl = mockPush.mock.calls.at(-1)?.[0] as string
    expect(pushedUrl).toContain('segment=55')
    expect(pushedUrl).toContain('query=smith')
  })

  it('clears the query param when selecting a list saved without a search', async () => {
    mockContactsList()
    api.mock('GET /v1/voters/voter-file/filters', {
      status: 200,
      data: [{ id: 56, name: 'Door knockers' }],
    })

    renderSelectProbe('56')

    const button = await screen.findByTestId('select')
    await waitFor(() => expect(button).toHaveAttribute('data-loaded', 'true'))
    button.click()

    await waitFor(() => expect(mockPush).toHaveBeenCalled())
    const pushedUrl = mockPush.mock.calls.at(-1)?.[0] as string
    expect(pushedUrl).toContain('segment=56')
    expect(pushedUrl).not.toContain('query=')
  })
})
