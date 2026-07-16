import { describe, it, expect, vi, beforeEach } from 'vitest'
import { memo, useEffect, useState } from 'react'
import { screen, waitFor, fireEvent } from '@testing-library/react'
import { render } from 'helpers/test-utils/render'
import { api } from 'helpers/test-utils/api-mocking'
import { CampaignContext } from '@shared/hooks/CampaignProvider'
import { useWinVoterDataFlag } from '@shared/experiments/winVoterDataFlag'
import {
  ContactsTableProvider,
  useContactsTable,
} from './ContactsTableProvider'
import { makePerson } from './shared/test-fixtures'

// The real navigation hooks return a new reference only when the URL actually
// changes, so an unrelated provider re-render (a keystroke in a sibling, a
// parent state tick) must NOT churn these. A naive mock that returns a fresh
// instance per call would defeat the very memoization under test, so pin them.
const stableSearchParams = new URLSearchParams()
const stableParams: Record<string, string | string[]> = {}
const stableCampaign: [null] = [null]
// Next's App Router hooks return stable references across renders (the router
// object, the pathname string, and the searchParams object only change when
// the URL changes). Mirror that here — a mock that minted a fresh router per
// call would make every URL-mutating callback churn and mask the real fix.
const stableRouter = { push: vi.fn() }

vi.mock('next/navigation', () => ({
  useRouter: () => stableRouter,
  usePathname: () => '/dashboard/contacts',
  useSearchParams: () => stableSearchParams,
  useParams: () => stableParams,
}))

vi.mock('@shared/experiments/winVoterDataFlag', () => ({
  useWinVoterDataFlag: vi.fn(),
}))

// The provider and useElectedOffice both read the active org from here.
vi.mock('@shared/organization-picker', () => ({
  useOrganization: () => ({ slug: 'org-one' }),
}))

const mockedUseWinVoterDataFlag = vi.mocked(useWinVoterDataFlag)

beforeEach(() => {
  mockedUseWinVoterDataFlag.mockReset()
  mockedUseWinVoterDataFlag.mockReturnValue({ ready: true, enabled: false })
})

const mockSupportingEndpoints = () => {
  api.mock('GET /v1/elected-office/current', {
    status: 404,
    data: { message: 'not found' },
  })
  api.mock('GET /v1/voters/voter-file/filters', { status: 200, data: [] })
}

const paginationFor = (hasNextPage: boolean) => ({
  totalResults: hasNextPage ? 40 : 1,
  currentPage: 1,
  pageSize: 20,
  totalPages: hasNextPage ? 2 : 1,
  hasNextPage,
  hasPreviousPage: false,
})

const LoadProbe = () => {
  const { isLoading } = useContactsTable()
  return <span data-testid="loading">{String(isLoading)}</span>
}

describe('ContactsTableProvider — context value memoization', () => {
  it('does not re-render a memoized consumer when the provider re-renders without input changes', async () => {
    mockSupportingEndpoints()
    api.mock('GET /v1/contacts', {
      status: 200,
      data: { people: [makePerson()], pagination: paginationFor(false) },
    })

    // Count committed renders of the memoized consumer. A memo'd consumer only
    // commits when the context value it reads changes reference, so this is a
    // direct read on whether the provider handed it a new object.
    const commits = { count: 0 }
    const Consumer = memo(function Consumer() {
      useContactsTable()
      useEffect(() => {
        commits.count += 1
      })
      return <span data-testid="consumer" />
    })

    const Harness = () => {
      const [, setTick] = useState(0)
      return (
        <CampaignContext.Provider value={stableCampaign}>
          <button data-testid="tick" onClick={() => setTick((t) => t + 1)} />
          <ContactsTableProvider>
            <Consumer />
            <LoadProbe />
          </ContactsTableProvider>
        </CampaignContext.Provider>
      )
    }

    render(<Harness />)

    await waitFor(() =>
      expect(screen.getByTestId('loading')).toHaveTextContent('false'),
    )

    const commitsAfterSettle = commits.count

    // Five unrelated provider re-renders (parent state ticks). None of them
    // touch any context input, so a correctly-memoized value keeps the same
    // reference and the memoized consumer must not re-render.
    const ticks = 5
    for (let i = 0; i < ticks; i++) {
      fireEvent.click(screen.getByTestId('tick'))
    }

    const extraRenders = commits.count - commitsAfterSettle

    // Before the fix: 5 (one wasted consumer re-render per provider render).
    // After the fix: 0.
    expect(extraRenders).toBe(0)
  })
})

describe('ContactsTableProvider — next-page prefetch guard', () => {
  it('does not prefetch page 2 when hasNextPage is false', async () => {
    const requestedPages: string[] = []
    mockSupportingEndpoints()
    api.mock('GET /v1/contacts', (request) => {
      requestedPages.push(String(request.query.page ?? 1))
      return {
        status: 200,
        data: { people: [makePerson()], pagination: paginationFor(false) },
      }
    })

    render(
      <CampaignContext.Provider value={stableCampaign}>
        <ContactsTableProvider>
          <LoadProbe />
        </ContactsTableProvider>
      </CampaignContext.Provider>,
    )

    await waitFor(() =>
      expect(screen.getByTestId('loading')).toHaveTextContent('false'),
    )
    // Give any (incorrectly) enabled prefetch a chance to fire before asserting.
    await new Promise((resolve) => setTimeout(resolve, 30))

    expect(requestedPages).not.toContain('2')
    expect(requestedPages).toEqual(['1'])
  })

  it('still prefetches page 2 when hasNextPage is true (no regression)', async () => {
    const requestedPages: string[] = []
    mockSupportingEndpoints()
    api.mock('GET /v1/contacts', (request) => {
      const page = String(request.query.page ?? 1)
      requestedPages.push(page)
      return {
        status: 200,
        data: {
          people: [makePerson()],
          pagination: paginationFor(page === '1'),
        },
      }
    })

    render(
      <CampaignContext.Provider value={stableCampaign}>
        <ContactsTableProvider>
          <LoadProbe />
        </ContactsTableProvider>
      </CampaignContext.Provider>,
    )

    await waitFor(() => expect(requestedPages).toContain('2'))
    expect(requestedPages).toContain('1')
  })
})
