import { queryOptions, useQuery } from '@tanstack/react-query'
import { clientRequest } from 'gpApi/typed-request'
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
  // The unavailable states below are permanent for the org, not transient, so
  // the global retry:2 default just triples a request we know will fail.
  retry: false,
})

// Which of the two failures blocked the user. Reported on the block's
// analytics event so the two populations stay separable: an unresolvable
// district is usually a write-in office name (fixable by the user), while a
// missing DistrictStats row is our data gap (fixable only by us).
export type DistrictStatsUnavailableReason =
  | 'unresolvable_district'
  | 'stats_unavailable'

export const districtStatsUnavailableReason = (
  isUnresolvable: boolean,
  isError: boolean,
): DistrictStatsUnavailableReason | null =>
  isUnresolvable
    ? 'unresolvable_district'
    : isError
      ? 'stats_unavailable'
      : null

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
  })
  const unavailableReason = districtStatsUnavailableReason(
    isUnresolvable,
    query.isError,
  )

  return { ...query, isUnavailable: !!unavailableReason, unavailableReason }
}
