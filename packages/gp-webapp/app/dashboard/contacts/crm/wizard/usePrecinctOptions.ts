import { useQuery } from '@tanstack/react-query'
import { clientRequest } from 'gpApi/typed-request'
import { useOrganization } from '@shared/organization-picker'
import type { PrecinctOption } from '@goodparty_org/contracts'

// The district's precinct vocabulary. Keyed on the org rather than on the
// in-progress filter payload: the option list is deliberately unfiltered
// server-side, so it does not change as the user narrows other filters and
// never needs refetching mid-build.
export interface PrecinctOptionsResult {
  options: PrecinctOption[]
  truncated: boolean
  isLoading: boolean
  isError: boolean
  refetch: () => void
}

// Offered to Win and Serve alike, unlike political_party / contacts_made /
// voter_likely: a precinct is an administrative subdivision of the district an
// official already serves, so it narrows a constituent list as meaningfully as
// it narrows a voter one. `enabled` is the caller's own gating (the wizard is
// shut, voter data is unavailable), not a product rule.
export const usePrecinctOptions = (enabled: boolean): PrecinctOptionsResult => {
  const orgSlug = useOrganization()?.slug

  const query = useQuery({
    queryKey: ['contacts-precincts', orgSlug],
    queryFn: () =>
      clientRequest('GET /v1/contacts/precincts', {}).then((res) => res.data),
    enabled: enabled && Boolean(orgSlug),
    // The voter file refreshes on a weekly cadence, so this is effectively
    // static for a session. Caching it keeps reopening the wizard free.
    staleTime: 60 * 60 * 1000,
    refetchOnWindowFocus: false,
    // A failed precinct list must not block saving a list on the other
    // filters, so this never retries into a long spinner.
    retry: 1,
  })

  return {
    options: query.data?.options ?? [],
    truncated: query.data?.truncated ?? false,
    isLoading: query.isPending || query.isFetching,
    isError: query.isError,
    refetch: () => void query.refetch(),
  }
}
