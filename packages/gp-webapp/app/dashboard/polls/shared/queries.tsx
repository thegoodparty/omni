import { queryOptions, useQuery } from '@tanstack/react-query'
import { FetchError } from 'ofetch'
import { clientRequest } from 'gpApi/typed-request'
import { extractApiErrorInfo } from 'helpers/extractApiErrorInfo'
import { VOTER_DATA_UNAVAILABLE_ERROR_CODE } from 'app/dashboard/contacts/crm/shared/constants'
import { useDistrictResolution } from 'app/dashboard/shared/useDistrictResolution'

export type ContactStatsBucket = {
  label: string
  count: number
  percent: number
}
export type ContactStatsCategory = ContactStatsBucket[]

export type ContactsStats = {
  districtId: string
  computedAt: string
  totalConstituents: number
  totalConstituentsWithCellPhone: number
  buckets: {
    age: ContactStatsCategory
    homeowner: ContactStatsCategory
    education: ContactStatsCategory
    presenceOfChildren: ContactStatsCategory
    estimatedIncomeRange: ContactStatsCategory
  }
}

export const districtStatsQueryOptions = queryOptions({
  queryKey: ['contacts-stats'],
  queryFn: () =>
    clientRequest('GET /v1/contacts/stats', {}).then((res) => res.data),
})

// Only the polls gate needs this: it branches on the failure, so a
// VOTER_DATA_UNAVAILABLE (permanent for the org) must not be retried into a
// slow dead-end, while a 5xx must be. It lives on the hooks rather than on
// districtStatsQueryOptions because a `retry` there would override the
// client-level policy for every other consumer of these options — the
// contacts stat cards and lists included, which just want the default.
const pollsGateRetry = (failureCount: number, error: unknown): boolean =>
  !isVoterDataUnavailable(error) && failureCount < 2

const isVoterDataUnavailable = (error: unknown): boolean =>
  error instanceof FetchError &&
  extractApiErrorInfo(error.data).errorCode ===
    VOTER_DATA_UNAVAILABLE_ERROR_CODE

// Why the user is blocked. Reported on the block's analytics event so the
// populations stay separable: an unresolvable district is usually a write-in
// office name (fixable by the user), a missing DistrictStats row is our data
// gap, and `stats_error` is neither — a request that kept failing, which we
// still have to block on because the flow can't price an unknown audience.
export type DistrictStatsUnavailableReason =
  | 'unresolvable_district'
  | 'stats_unavailable'
  | 'stats_error'

export { pollsGateRetry }

export const districtStatsUnavailableReason = (
  isUnresolvable: boolean,
  error: unknown,
): DistrictStatsUnavailableReason | null =>
  isUnresolvable
    ? 'unresolvable_district'
    : !error
      ? null
      : isVoterDataUnavailable(error)
        ? 'stats_unavailable'
        : 'stats_error'

// `isUnresolvable` only *predicts* that constituent data is missing, from the
// org having no district. A district that resolves but has no DistrictStats
// row fails the same way and the predicate can't see it, so those orgs used to
// sail past every gate into a flow whose send-size math resolves to NaN. Treat
// the request's own outcome as the truth; the predicate stays purely as an
// optimization that skips a call we already know is doomed.
export const useDistrictStats = () => {
  const { isUnresolvable } = useDistrictResolution()
  const query = useQuery({
    ...districtStatsQueryOptions,
    enabled: !isUnresolvable,
    retry: pollsGateRetry,
  })
  const unavailableReason = districtStatsUnavailableReason(
    isUnresolvable,
    query.error,
  )

  return { ...query, isUnavailable: !!unavailableReason, unavailableReason }
}
