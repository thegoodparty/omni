import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { queryClientConfig } from '@shared/query-client'
import { api } from 'helpers/test-utils/api-mocking'
import { setCookie, deleteCookie } from 'helpers/cookieHelper'
import { ORG_SLUG_COOKIE } from '@shared/organizations/constants'
import { useWinVoterDataFlag } from '@shared/experiments/winVoterDataFlag'
import { useOrganization } from '@shared/organization-picker'
import { useWinVoterContext } from './useWinVoterContext'
import type { ElectedOffice, Organization } from 'gpApi/api-endpoints'

vi.mock('@shared/experiments/winVoterDataFlag', () => ({
  useWinVoterDataFlag: vi.fn(),
}))

vi.mock('@shared/organization-picker', () => ({
  useOrganization: vi.fn(),
}))

const mockedUseWinVoterDataFlag = vi.mocked(useWinVoterDataFlag)
const mockedUseOrganization = vi.mocked(useOrganization)

const SERVE_SLUG = 'eo-serve-org'
const WIN_SLUG = 'win-campaign-org'

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

const makeOrg = (slug: string): Organization =>
  ({ slug, name: slug }) as Organization

// A single client across both renders mirrors switching orgs in the same tab
// (or a focus refetch / deep link). gpFetch sends the active org as
// X-Organization-Slug from the cookie, so the active org is set on both axes:
// the cookie (drives the header the API keys off) and useOrganization (drives
// the React Query key). With an org-unscoped electedOffice key, the second
// render would read the first org's cached value instead of refetching.
const sharedClient = new QueryClient({
  ...queryClientConfig,
  defaultOptions: {
    ...queryClientConfig.defaultOptions,
    queries: {
      ...queryClientConfig.defaultOptions?.queries,
      retry: false,
    },
  },
})

const renderForOrg = (slug: string) => {
  setCookie(ORG_SLUG_COOKIE, slug)
  mockedUseOrganization.mockReturnValue(makeOrg(slug))
  return renderHook(() => useWinVoterContext(), {
    wrapper: ({ children }) => (
      <QueryClientProvider client={sharedClient}>
        {children}
      </QueryClientProvider>
    ),
  })
}

beforeEach(() => {
  sharedClient.clear()
  mockedUseWinVoterDataFlag.mockReset()
  mockedUseOrganization.mockReset()
  mockedUseWinVoterDataFlag.mockReturnValue({ ready: true, enabled: true })
  // The Serve (eo-) org resolves an elected office; the Win org has none.
  api.mock('GET /v1/elected-office/current', ({ headers }) =>
    headers['x-organization-slug'] === SERVE_SLUG
      ? { status: 200, data: electedOfficeFixture }
      : { status: 404, data: { message: 'not found' } },
  )
})

afterEach(() => {
  deleteCookie(ORG_SLUG_COOKIE)
})

describe('useWinVoterContext — org-scoped elected-office read', () => {
  it('reports isWin per the active org and never serves the prior org cached elected-office', async () => {
    const serve = renderForOrg(SERVE_SLUG)
    await waitFor(() => expect(serve.result.current.isReady).toBe(true))
    expect(serve.result.current.isWin).toBe(false)

    const win = renderForOrg(WIN_SLUG)
    await waitFor(() => expect(win.result.current.isReady).toBe(true))
    // Win has no elected office, so isWin must be true. A stale read of the
    // Serve org's cached elected office would leave this false and render
    // Serve copy on the Win contacts page (ENG-10511).
    expect(win.result.current.isWin).toBe(true)
  })
})
