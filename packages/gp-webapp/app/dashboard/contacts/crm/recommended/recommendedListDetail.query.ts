import { queryOptions } from '@tanstack/react-query'
import type { RecommendedList } from '@goodparty_org/contracts'
import { clientRequest } from 'gpApi/typed-request'
import { builderFiltersFromRecommendation } from 'app/dashboard/outreach/v2/audience/recommendedListMapping.util'
import { transformVoterFileFiltersForBackend } from '../shared/voterFileFilterTransform.util'

// The list-detail aggregates for a recommendation that has not been saved,
// keyed once so the detail sheet and the channel picker share the warm
// result rather than each spending a warehouse aggregate. Fed the same
// builder translation the flows persist, so the figures are the figures
// saving the list would show.
export const recommendedListDetailQueryOptions = (
  orgSlug: string | undefined,
  recommendation: RecommendedList,
) =>
  queryOptions({
    queryKey: ['recommended-list-detail', orgSlug, recommendation.variant],
    queryFn: async () => {
      const { filter } = recommendation
      const { data } = await clientRequest('POST /v1/contacts/list-detail', {
        ...transformVoterFileFiltersForBackend(
          builderFiltersFromRecommendation(filter),
        ),
        ...(filter.supportStatus?.length
          ? { supportStatus: filter.supportStatus }
          : {}),
        ...(filter.precincts?.length ? { precincts: filter.precincts } : {}),
      })
      return data
    },
    refetchOnWindowFocus: false,
  })
