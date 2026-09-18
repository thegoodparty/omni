import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import {
  COMPLIANCE_STATE_QUERY_KEY,
  TCR_COMPLIANCE_QUERY_KEY,
} from 'app/dashboard/profile/texting-compliance/util/tcrCompliance.util'
import { useMembershipState } from './useMembershipState'

const { mockUseQuery, mockUseCampaign, mockUseElectedOffice } = vi.hoisted(
  () => ({
    mockUseQuery: vi.fn(),
    mockUseCampaign: vi.fn(),
    mockUseElectedOffice: vi.fn(),
  }),
)

vi.mock('@tanstack/react-query', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tanstack/react-query')>()),
  useQuery: (options: { queryKey: readonly string[]; enabled?: boolean }) =>
    mockUseQuery(options),
}))
vi.mock('@shared/hooks/useCampaign', () => ({
  useCampaign: () => mockUseCampaign(),
}))
vi.mock('@shared/hooks/useElectedOffice', () => ({
  useElectedOffice: () => mockUseElectedOffice(),
}))

const queryOptions = (key: readonly string[]) =>
  mockUseQuery.mock.calls
    .map(([options]) => options)
    .find((options) => options.queryKey === key)

beforeEach(() => {
  vi.clearAllMocks()
  mockUseCampaign.mockReturnValue([{ isPro: true }])
  mockUseElectedOffice.mockReturnValue({ data: null, isPending: false })
  mockUseQuery.mockImplementation(
    ({ queryKey }: { queryKey: readonly string[] }) =>
      queryKey === TCR_COMPLIANCE_QUERY_KEY
        ? {
            data: { status: 'submitted', peerlyIdentityId: 'peerly-1' },
            isPending: false,
          }
        : {
            data: { peerlyCvStatus: null, pinDelivery: null },
            isPending: false,
          },
  )
})

describe('useMembershipState', () => {
  it('reads the TCR and compliance-state queries when enabled', () => {
    const { result } = renderHook(() => useMembershipState())

    expect(queryOptions(TCR_COMPLIANCE_QUERY_KEY)?.enabled).toBe(true)
    expect(queryOptions(COMPLIANCE_STATE_QUERY_KEY)?.enabled).toBe(true)
    expect(result.current.ready).toBe(true)
  })

  it('disables both queries, and never reports ready, when disabled', () => {
    const { result } = renderHook(() => useMembershipState({ enabled: false }))

    expect(queryOptions(TCR_COMPLIANCE_QUERY_KEY)?.enabled).toBe(false)
    expect(queryOptions(COMPLIANCE_STATE_QUERY_KEY)?.enabled).toBe(false)
    expect(result.current.ready).toBe(false)
    expect(result.current.state).toBeNull()
    expect(result.current.tcrCompliance).toBeNull()
  })

  it('disables both queries, and never reports ready, without a campaign', () => {
    // No campaign means no membership surface can render, so the TCR read
    // would be paid for a UI that never appears.
    mockUseCampaign.mockReturnValue([undefined])

    const { result } = renderHook(() => useMembershipState())

    expect(queryOptions(TCR_COMPLIANCE_QUERY_KEY)?.enabled).toBe(false)
    expect(queryOptions(COMPLIANCE_STATE_QUERY_KEY)?.enabled).toBe(false)
    expect(result.current.ready).toBe(false)
    expect(result.current.state).toBeNull()
  })

  it('leaves the compliance-state query off for a record that never reached Peerly', () => {
    mockUseQuery.mockImplementation(
      ({ queryKey }: { queryKey: readonly string[] }) =>
        queryKey === TCR_COMPLIANCE_QUERY_KEY
          ? { data: { status: 'pending' }, isPending: false }
          : { data: undefined, isPending: true },
    )

    renderHook(() => useMembershipState())

    expect(queryOptions(COMPLIANCE_STATE_QUERY_KEY)?.enabled).toBe(false)
  })
})
