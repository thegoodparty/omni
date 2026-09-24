import { useQuery } from '@tanstack/react-query'
import { FetchError } from 'ofetch'
import { clientRequest } from 'gpApi/typed-request'
import { useOrganization } from '@shared/organization-picker'

export interface FilterPointsResult {
  points: { id: string; lat: number; lng: number }[]
  // Whether the district held more matches than the map's cap. Carried so the
  // caller can say so rather than showing a partial list that looks whole.
  truncated: boolean
  isLoading: boolean
  isError: boolean
}

// The dots behind the draw step: the list being built, not the district it
// sits in.
//
// Deliberately NOT debounced, unlike useListWizardPolygonCount beside it. The
// shape changes on every drag of a handle and the count has to keep up; the
// filters cannot change while this step is on screen, so the payload settles
// once on arrival and a debounce would only delay the map by 600ms.
//
// Keyed on the org slug as well as the filters, for the reason every contacts
// query is: a cached entry that survived an org switch would draw the
// previous organization's constituents at their real addresses.
export const useFilterPoints = (
  filters: Record<string, unknown>,
  enabled: boolean,
): FilterPointsResult => {
  const orgSlug = useOrganization()?.slug

  const query = useQuery({
    queryKey: ['list-wizard-filter-points', orgSlug, filters],
    queryFn: () =>
      clientRequest('POST /v1/contacts/points', { filters }).then(
        (res) => res.data,
      ),
    // Boolean(orgSlug) as well: before the org resolves, a fetch lands under
    // an undefined-slug key no later invalidation targets, so it is never
    // evicted and can be served stale forever.
    enabled: enabled && Boolean(orgSlug),
    // A contacts 4xx is deterministic — 400 is VOTER_DATA_UNAVAILABLE, 403 is
    // not-pro — so retrying only makes an ineligible user wait out the
    // backoff before the empty state can render.
    retry: (failureCount, error) =>
      !(
        error instanceof FetchError &&
        typeof error.status === 'number' &&
        error.status >= 400 &&
        error.status < 500
      ) && failureCount < 2,
    refetchOnWindowFocus: false,
  })

  return {
    points: query.data?.points ?? [],
    truncated: query.data?.truncated ?? false,
    // A disabled query stays isPending forever, so reading isPending alone
    // would spin while the org resolves — and reading it without the org
    // would report an unresolved list as an empty one.
    isLoading: enabled && (!orgSlug || query.isPending),
    isError: query.isError,
  }
}
