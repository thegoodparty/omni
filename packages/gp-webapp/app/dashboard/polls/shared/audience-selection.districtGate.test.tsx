import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderHook } from '@testing-library/react'
import { QueryClientProvider } from '@tanstack/react-query'
import { testQueryClient } from 'helpers/test-utils/render'
import { api } from 'helpers/test-utils/api-mocking'
import {
  calculateRecommendedPollSize,
  useTotalConstituentsWithCellPhone,
} from './audience-selection'

const mockOrg = vi.hoisted(() => ({ current: undefined as unknown }))
vi.mock('@shared/organization-picker', () => ({
  useOrganization: () => mockOrg.current,
}))

const wrapper = ({ children }: { children: React.ReactNode }) => (
  <QueryClientProvider client={testQueryClient}>{children}</QueryClientProvider>
)

const statsResponse = {
  districtId: 'district-1',
  computedAt: '2026-08-01T00:00:00.000Z',
  totalConstituents: 40000,
  totalConstituentsWithCellPhone: 20000,
  buckets: {
    age: [],
    homeowner: [],
    education: [],
    presenceOfChildren: [],
    estimatedIncomeRange: [],
  },
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

beforeEach(() => {
  testQueryClient.clear()
  mockOrg.current = {
    slug: 'eo-1',
    positionName: 'City Council',
    district: { id: 'd1', l2Type: 'City', l2Name: 'Austin' },
  }
})

describe('useTotalConstituentsWithCellPhone — district gate', () => {
  const mockStats = () => {
    const onRequest = vi.fn()
    api.mock('GET /v1/contacts/stats', () => {
      onRequest()
      return { status: 200, data: statsResponse }
    })
    return onRequest
  }

  it('fetches and reports available when a district resolves', async () => {
    const onRequest = mockStats()

    const { result } = renderHook(() => useTotalConstituentsWithCellPhone(), {
      wrapper,
    })
    await flush()

    expect(onRequest).toHaveBeenCalled()
    expect(result.current.isUnavailable).toBe(false)
  })

  // Consumers branch on `status !== 'success'` to show a spinner, so an
  // enabled:false query without an explicit unavailable flag would spin forever.
  it('fires no request and reports unavailable when the district is unresolvable', async () => {
    const onRequest = mockStats()
    mockOrg.current = {
      slug: 'eo-1',
      positionName: 'City Council',
      district: null,
    }

    const { result } = renderHook(() => useTotalConstituentsWithCellPhone(), {
      wrapper,
    })
    await flush()

    expect(onRequest).not.toHaveBeenCalled()
    expect(result.current.isUnavailable).toBe(true)
  })

  // A 5xx is not a permanent data gap, so it must not be swallowed as one:
  // retry first, and label it distinctly if it never recovers.
  it('retries a transient failure instead of treating it as a data gap', async () => {
    let attempts = 0
    api.mock('GET /v1/contacts/stats', () => {
      attempts += 1
      return attempts === 1
        ? { status: 503, data: { message: 'upstream unavailable' } }
        : { status: 200, data: statsResponse }
    })

    const { result } = renderHook(() => useTotalConstituentsWithCellPhone(), {
      wrapper,
    })
    await vi.waitFor(() => expect(result.current.isSuccess).toBe(true))

    expect(attempts).toBeGreaterThan(1)
    expect(result.current.isUnavailable).toBe(false)
  })

  it('labels an unrecovered transient failure separately from a data gap', async () => {
    api.mock('GET /v1/contacts/stats', {
      status: 503,
      data: { message: 'upstream unavailable' },
    })

    const { result } = renderHook(() => useTotalConstituentsWithCellPhone(), {
      wrapper,
    })
    await vi.waitFor(() => expect(result.current.isError).toBe(true), {
      timeout: 5000,
    })

    expect(result.current.unavailableReason).toBe('stats_error')
  })

  // The district resolves, so the predicate says available — the missing
  // DistrictStats row only shows up in the response.
  it('reports unavailable when a resolvable district has no stats', async () => {
    api.mock('GET /v1/contacts/stats', {
      status: 400,
      data: {
        message: 'District stats not available',
        errorCode: 'VOTER_DATA_UNAVAILABLE',
      },
    })

    const { result } = renderHook(() => useTotalConstituentsWithCellPhone(), {
      wrapper,
    })
    await vi.waitFor(() => expect(result.current.isError).toBe(true))

    expect(result.current.isUnavailable).toBe(true)
  })
})

describe('calculateRecommendedPollSize', () => {
  it('computes normally with a real total', () => {
    const result = calculateRecommendedPollSize({
      expectedResponseRate: 0.05,
      totalConstituentsWithCellPhone: 20000,
      alreadySent: 0,
      responsesAlreadyReceived: 0,
    })

    expect(Number.isNaN(result.recommendedSendCount)).toBe(false)
    expect(result.recommendedSendCount).toBeGreaterThan(0)
  })

  // MAX_CONSTITUENTS_PER_RUN - undefined is NaN, and the value flows straight
  // into the audience options and the cost preview.
  it('never returns NaN when the total is missing', () => {
    const result = calculateRecommendedPollSize({
      expectedResponseRate: 0.05,
      totalConstituentsWithCellPhone: undefined as unknown as number,
      alreadySent: 0,
      responsesAlreadyReceived: 0,
    })

    expect(Number.isNaN(result.recommendedSendCount)).toBe(false)
    expect(Number.isNaN(result.totalRemainingUsableConstituents)).toBe(false)
    expect(result.totalRemainingUsableConstituents).toBe(0)
    expect(result.recommendedSendCount).toBe(0)
  })
})
