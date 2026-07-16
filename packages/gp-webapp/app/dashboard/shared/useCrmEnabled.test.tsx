import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { queryClientConfig } from '@shared/query-client'
import { api } from 'helpers/test-utils/api-mocking'
import { setCookie, deleteCookie } from 'helpers/cookieHelper'
import { ORG_SLUG_COOKIE } from '@shared/organizations/constants'
import { electedOfficeQueryOptions } from '@shared/hooks/useElectedOffice'
import { useWinVoterDataFlag } from '@shared/experiments/winVoterDataFlag'
import { useWinCrmFlag } from '@shared/experiments/winCrmFlag'
import { useServeCrmFlag } from '@shared/experiments/serveCrmFlag'
import { useOrganization } from '@shared/organization-picker'
import { useCrmEnabled } from './useCrmEnabled'
import type { ElectedOffice, Organization } from 'gpApi/api-endpoints'

vi.mock('@shared/experiments/winVoterDataFlag', () => ({
  useWinVoterDataFlag: vi.fn(),
}))

vi.mock('@shared/experiments/winCrmFlag', () => ({
  useWinCrmFlag: vi.fn(),
}))

vi.mock('@shared/experiments/serveCrmFlag', () => ({
  useServeCrmFlag: vi.fn(),
}))

vi.mock('@shared/organization-picker', () => ({
  useOrganization: vi.fn(),
}))

const mockedUseWinVoterDataFlag = vi.mocked(useWinVoterDataFlag)
const mockedUseWinCrmFlag = vi.mocked(useWinCrmFlag)
const mockedUseServeCrmFlag = vi.mocked(useServeCrmFlag)
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
  campaignId: null,
}

const makeOrg = (slug: string): Organization =>
  ({ slug, name: slug }) as Organization

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

const renderForOrg = (slug: string, trackExposure?: boolean) => {
  setCookie(ORG_SLUG_COOKIE, slug)
  mockedUseOrganization.mockReturnValue(makeOrg(slug))
  return renderHook(() => useCrmEnabled(trackExposure), {
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
  mockedUseWinCrmFlag.mockReset()
  mockedUseServeCrmFlag.mockReset()
  mockedUseOrganization.mockReset()
  mockedUseWinVoterDataFlag.mockReturnValue({ ready: true, enabled: true })
  mockedUseWinCrmFlag.mockReturnValue({ ready: true, enabled: false })
  mockedUseServeCrmFlag.mockReturnValue({ ready: true, enabled: false })
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

describe('useCrmEnabled — mode × flag matrix', () => {
  it('is disabled for a Win org with win-crm off', async () => {
    const { result } = renderForOrg(WIN_SLUG)

    await waitFor(() => expect(result.current.ready).toBe(true))
    expect(result.current.enabled).toBe(false)
  })

  it('is enabled for a Win org with win-crm on', async () => {
    mockedUseWinCrmFlag.mockReturnValue({ ready: true, enabled: true })

    const { result } = renderForOrg(WIN_SLUG)

    await waitFor(() => expect(result.current.ready).toBe(true))
    expect(result.current.enabled).toBe(true)
  })

  it('is disabled for a Serve org with serve-crm off', async () => {
    const { result } = renderForOrg(SERVE_SLUG)

    await waitFor(() => expect(result.current.ready).toBe(true))
    expect(result.current.enabled).toBe(false)
  })

  it('is enabled for a Serve org with serve-crm on', async () => {
    mockedUseServeCrmFlag.mockReturnValue({ ready: true, enabled: true })

    const { result } = renderForOrg(SERVE_SLUG)

    await waitFor(() => expect(result.current.ready).toBe(true))
    expect(result.current.enabled).toBe(true)
  })

  it('ignores serve-crm on a Win org', async () => {
    mockedUseServeCrmFlag.mockReturnValue({ ready: true, enabled: true })

    const { result } = renderForOrg(WIN_SLUG)

    await waitFor(() => expect(result.current.ready).toBe(true))
    expect(result.current.enabled).toBe(false)
  })

  it('ignores win-crm on a Serve org', async () => {
    mockedUseWinCrmFlag.mockReturnValue({ ready: true, enabled: true })

    const { result } = renderForOrg(SERVE_SLUG)

    await waitFor(() => expect(result.current.ready).toBe(true))
    expect(result.current.enabled).toBe(false)
  })

  it('never lets serve-crm decide for a Win org with win-voter-data off', async () => {
    mockedUseWinVoterDataFlag.mockReturnValue({ ready: true, enabled: false })
    mockedUseServeCrmFlag.mockReturnValue({ ready: true, enabled: true })

    const { result } = renderForOrg(WIN_SLUG)

    await waitFor(() => expect(result.current.ready).toBe(true))
    expect(result.current.enabled).toBe(false)
  })

  it('keeps win-voter-data as a layered gate: win-crm on alone does not enable a Win org', async () => {
    mockedUseWinVoterDataFlag.mockReturnValue({ ready: true, enabled: false })
    mockedUseWinCrmFlag.mockReturnValue({ ready: true, enabled: true })

    const { result } = renderForOrg(WIN_SLUG)

    await waitFor(() => expect(result.current.ready).toBe(true))
    expect(result.current.enabled).toBe(false)
  })
})

describe('useCrmEnabled — readiness', () => {
  it('is not ready (and not enabled) while the elected-office query is in flight, even with the flags settled', async () => {
    mockedUseWinCrmFlag.mockReturnValue({ ready: true, enabled: true })

    const { result } = renderForOrg(WIN_SLUG)

    expect(result.current).toEqual({ ready: false, enabled: false })

    await waitFor(() => expect(result.current.ready).toBe(true))
    expect(result.current.enabled).toBe(true)
  })

  it('is not ready (and not enabled) until the deciding flag settles, even after the elected-office query resolves', async () => {
    mockedUseWinCrmFlag.mockReturnValue({ ready: false, enabled: false })

    const { result, rerender } = renderForOrg(WIN_SLUG)

    const queryKey = electedOfficeQueryOptions(WIN_SLUG).queryKey
    await waitFor(() =>
      expect(sharedClient.getQueryState(queryKey)?.status).toBe('success'),
    )
    expect(result.current).toEqual({ ready: false, enabled: false })

    mockedUseWinCrmFlag.mockReturnValue({ ready: true, enabled: true })
    rerender()

    expect(result.current).toEqual({ ready: true, enabled: true })
  })
})

describe('useCrmEnabled — exposure', () => {
  it('reads both flags without exposure by default', async () => {
    const { result } = renderForOrg(WIN_SLUG)

    await waitFor(() => expect(result.current.ready).toBe(true))
    expect(mockedUseWinCrmFlag).toHaveBeenLastCalledWith(false)
    expect(mockedUseServeCrmFlag).toHaveBeenLastCalledWith(false)
  })

  it('with trackExposure, exposes only win-crm on a Win org, and only after the mode settles', async () => {
    const { result } = renderForOrg(WIN_SLUG, true)

    expect(mockedUseWinCrmFlag).toHaveBeenNthCalledWith(1, false)

    await waitFor(() => expect(result.current.ready).toBe(true))
    expect(mockedUseWinCrmFlag).toHaveBeenLastCalledWith(true)
    expect(mockedUseServeCrmFlag).toHaveBeenLastCalledWith(false)
  })

  it('with trackExposure, exposes only serve-crm on a Serve org', async () => {
    const { result } = renderForOrg(SERVE_SLUG, true)

    await waitFor(() => expect(result.current.ready).toBe(true))
    expect(mockedUseServeCrmFlag).toHaveBeenLastCalledWith(true)
    expect(mockedUseWinCrmFlag).toHaveBeenLastCalledWith(false)
  })

  it('with trackExposure, exposes neither flag on a Win org with win-voter-data off', async () => {
    mockedUseWinVoterDataFlag.mockReturnValue({ ready: true, enabled: false })

    const { result } = renderForOrg(WIN_SLUG, true)

    await waitFor(() => expect(result.current.ready).toBe(true))
    expect(mockedUseWinCrmFlag).toHaveBeenLastCalledWith(false)
    expect(mockedUseServeCrmFlag).toHaveBeenLastCalledWith(false)
  })
})
