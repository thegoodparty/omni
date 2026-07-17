import {
  describe,
  it,
  expect,
  vi,
  beforeEach,
  afterEach,
  type MockInstance,
} from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import { render } from 'helpers/test-utils/render'
import { api } from 'helpers/test-utils/api-mocking'
import { CampaignContext } from '@shared/hooks/CampaignProvider'
import { useWinVoterDataFlag } from '@shared/experiments/winVoterDataFlag'
import {
  ContactsTableProvider,
  useContactsTable,
} from './ContactsTableProvider'
import { makePerson } from './shared/test-fixtures'
import type { ElectedOffice } from 'gpApi/api-endpoints'
import type { Person } from './shared/contacts-types'

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
  campaignId: null,
}

// The provider reads three navigation hooks; the global setup only mocks
// useRouter/usePathname, so provide the rest here. pathname is mutable so a
// test can select a person (drives the engagement queries) — the provider
// derives the selected id from the pathname, not from route params.
let mockPathname = '/dashboard/contacts'
let mockSearchParams = new URLSearchParams()
let mockPush = vi.fn()

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush }),
  usePathname: () => mockPathname,
  useSearchParams: () => mockSearchParams,
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
  mockPathname = '/dashboard/contacts'
  mockSearchParams = new URLSearchParams()
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

  it('passes personId as :id and lalVoterId as a query param for the Win activities branch', async () => {
    mockPathname = '/dashboard/contacts/p_1'
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
    let capturedLalVoterId: string | undefined
    api.mock('GET /v1/contact-engagement/:id/activities', (request) => {
      capturedId = request.params.id
      capturedLalVoterId = request.query.lalVoterId
      return { status: 200, data: { nextCursor: null, results: [] } }
    })

    renderProvider()

    await waitFor(() => expect(capturedId).toBe('p_1'))
    expect(capturedLalVoterId).toBe('lal_1')
  })

  it('passes person.id and no lalVoterId for the Serve (elected office) activities branch', async () => {
    mockPathname = '/dashboard/contacts/p_1'
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
    let capturedLalVoterId: string | undefined
    api.mock('GET /v1/contact-engagement/:id/activities', (request) => {
      capturedId = request.params.id
      capturedLalVoterId = request.query.lalVoterId
      return { status: 200, data: { nextCursor: null, results: [] } }
    })

    renderProvider()

    await waitFor(() => expect(capturedId).toBe('p_1'))
    expect(capturedLalVoterId).toBeUndefined()
  })

  it('never sends the Win-keyed lalVoterId query param for an elected official while the flag is on (loading-window guard)', async () => {
    mockPathname = '/dashboard/contacts/p_1'
    mockedUseWinVoterDataFlag.mockReturnValue({ ready: true, enabled: true })
    mockContactsList()
    // Delay the elected-office resolution so the person fetch (with its
    // lalVoterId) settles first, recreating the loading window where
    // `electedOffice` is still undefined for a Serve user. Without the
    // isElectedOfficeLoading guard, isWinContext would be true here and a
    // lal_1 query param would leak onto the Serve request.
    api.mock('GET /v1/elected-office/current', async () => {
      await new Promise((resolve) => setTimeout(resolve, 50))
      return { status: 200, data: electedOfficeFixture }
    })
    api.mock('GET /v1/contacts/:id', {
      status: 200,
      data: makePerson({ id: 'p_1', lalVoterId: 'lal_1' }),
    })

    const capturedIds: string[] = []
    const capturedLalVoterIds: (string | undefined)[] = []
    api.mock('GET /v1/contact-engagement/:id/activities', (request) => {
      capturedIds.push(request.params.id)
      capturedLalVoterIds.push(request.query.lalVoterId)
      return { status: 200, data: { nextCursor: null, results: [] } }
    })

    renderProvider()

    await waitFor(() => expect(capturedIds).toContain('p_1'))
    expect(capturedLalVoterIds).not.toContain('lal_1')
  })

  it('waits for personQuery to settle before firing the Win activities request, so lalVoterId resolving mid-session cannot discard paged-in pages', async () => {
    mockPathname = '/dashboard/contacts/p_1'
    mockedUseWinVoterDataFlag.mockReturnValue({ ready: true, enabled: true })
    mockContactsList()
    api.mock('GET /v1/elected-office/current', {
      status: 404,
      data: { message: 'not found' },
    })

    let resolvePerson: (() => void) | undefined
    api.mock('GET /v1/contacts/:id', () => {
      return new Promise<{ status: 200; data: Person }>((resolve) => {
        resolvePerson = () =>
          resolve({
            status: 200,
            data: makePerson({ id: 'p_1', lalVoterId: 'lal_1' }),
          })
      })
    })

    const capturedRequests: { id: string; lalVoterId?: string }[] = []
    api.mock('GET /v1/contact-engagement/:id/activities', (request) => {
      capturedRequests.push({
        id: request.params.id,
        lalVoterId: request.query.lalVoterId,
      })
      return { status: 200, data: { nextCursor: null, results: [] } }
    })

    renderProvider()

    // The person fetch is in flight and deliberately unresolved — the
    // activities request must not fire yet (it would otherwise fire with
    // lalVoterId undefined, then re-fire under a new key once resolved).
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(capturedRequests).toHaveLength(0)

    resolvePerson?.()

    await waitFor(() => expect(capturedRequests).toHaveLength(1))
    expect(capturedRequests[0]).toEqual({ id: 'p_1', lalVoterId: 'lal_1' })
  })

  it('proceeds without lalVoterId once personQuery settles to an error, instead of deadlocking the feed', async () => {
    mockPathname = '/dashboard/contacts/p_1'
    mockedUseWinVoterDataFlag.mockReturnValue({ ready: true, enabled: true })
    mockContactsList()
    api.mock('GET /v1/elected-office/current', {
      status: 404,
      data: { message: 'not found' },
    })
    // Simulates people-api being unavailable: the person fetch settles to an
    // error rather than never resolving.
    api.mock('GET /v1/contacts/:id', {
      status: 500,
      data: { message: 'people-api unavailable' },
    })

    let capturedId: string | undefined
    let capturedLalVoterId: string | undefined
    api.mock('GET /v1/contact-engagement/:id/activities', (request) => {
      capturedId = request.params.id
      capturedLalVoterId = request.query.lalVoterId
      return { status: 200, data: { nextCursor: null, results: [] } }
    })

    renderProvider()

    await waitFor(() => expect(capturedId).toBe('p_1'))
    expect(capturedLalVoterId).toBeUndefined()
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

describe('ContactsTableProvider — shallow person selection (no route navigation)', () => {
  // Opening/closing a person must never go through router.push: the route is
  // force-dynamic with a loading.tsx, so a router navigation blanks the page
  // through the loading boundary. selectPerson uses native pushState instead,
  // and the selected id derives from usePathname (useParams does not react to
  // shallow pushState).
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

  const SelectionProbe = ({ personId }: { personId: string | null }) => {
    const { currentlySelectedPersonId, selectPerson } = useContactsTable()
    return (
      <div>
        <span data-testid="selected-id">
          {String(currentlySelectedPersonId)}
        </span>
        <button data-testid="go" onClick={() => selectPerson(personId)}>
          go
        </button>
      </div>
    )
  }

  const renderSelectionProbe = (personId: string | null) =>
    render(
      <CampaignContext.Provider value={[null]}>
        <ContactsTableProvider>
          <SelectionProbe personId={personId} />
        </ContactsTableProvider>
      </CampaignContext.Provider>,
    )

  let pushStateSpy: MockInstance

  beforeEach(() => {
    mockContactsList()
    pushStateSpy = vi.spyOn(window.history, 'pushState')
  })

  afterEach(() => {
    pushStateSpy.mockRestore()
  })

  it('selects a person via history.pushState preserving the query string, with no router.push', async () => {
    mockSearchParams = new URLSearchParams('segment=55&page=2')

    renderSelectionProbe('p_9')
    screen.getByTestId('go').click()

    await waitFor(() =>
      expect(pushStateSpy).toHaveBeenCalledWith(
        null,
        '',
        '/dashboard/contacts/p_9?segment=55&page=2',
      ),
    )
    expect(mockPush).not.toHaveBeenCalled()
  })

  it('closing (selectPerson(null)) returns to the base path preserving the query string', async () => {
    mockPathname = '/dashboard/contacts/p_9'
    mockSearchParams = new URLSearchParams('query=smith')

    renderSelectionProbe(null)
    screen.getByTestId('go').click()

    await waitFor(() =>
      expect(pushStateSpy).toHaveBeenCalledWith(
        null,
        '',
        '/dashboard/contacts?query=smith',
      ),
    )
    expect(mockPush).not.toHaveBeenCalled()
  })

  it('derives the selected person id from the pathname', () => {
    mockPathname = '/dashboard/contacts/p_7'

    renderSelectionProbe(null)

    expect(screen.getByTestId('selected-id')).toHaveTextContent('p_7')
  })

  it('reads no selection on the base path', () => {
    mockPathname = '/dashboard/contacts'

    renderSelectionProbe(null)

    expect(screen.getByTestId('selected-id')).toHaveTextContent('null')
  })

  it('reads no selection when the path has more than one extra segment', () => {
    mockPathname = '/dashboard/contacts/a/b'

    renderSelectionProbe(null)

    expect(screen.getByTestId('selected-id')).toHaveTextContent('null')
  })

  it('table URL updates push the base path, not the shallow person path', async () => {
    mockPathname = '/dashboard/contacts/p_9'
    mockSearchParams = new URLSearchParams('query=smith')

    const PageSizeProbe = () => {
      const { setPageSize } = useContactsTable()
      return (
        <button data-testid="resize" onClick={() => setPageSize(50)}>
          resize
        </button>
      )
    }
    render(
      <CampaignContext.Provider value={[null]}>
        <ContactsTableProvider>
          <PageSizeProbe />
        </ContactsTableProvider>
      </CampaignContext.Provider>,
    )
    screen.getByTestId('resize').click()

    await waitFor(() =>
      expect(mockPush).toHaveBeenCalledWith(
        '/dashboard/contacts?query=smith&pageSize=50&page=1',
        { scroll: false },
      ),
    )
  })
})
