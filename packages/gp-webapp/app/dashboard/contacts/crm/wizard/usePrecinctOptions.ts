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
    // `isLoading` (pending AND fetching), not `isPending || isFetching`.
    //
    // `isPending` is the status before a first success, not evidence that a
    // request exists: a query held back by `enabled` reports it forever, with
    // `fetchStatus: 'idle'`. Since every caller pipes this straight into
    // PrecinctFilter, whose first branch is a wall of skeletons, the old
    // disjunction spun the precinct group for good whenever a gate was shut —
    // no error, no retry, which reads as a broken filter rather than an
    // unavailable one. Both reachable gates (the wizard's
    // `voterDataUnavailable`, door knocking's `isUnresolvable`) stop the fetch
    // without stopping the control from rendering, and both sit beside a
    // surface message that already says why. Falling through to "No precinct
    // data found" is the truth on each.
    //
    // The disjunction's other half is not needed either. A retry still shows
    // skeletons, because refetching an errored query holding no data resets
    // its status to pending — and dropping `isFetching` additionally stops a
    // background refetch from flashing skeletons over pills already on screen.
    isLoading: query.isLoading,
    isError: query.isError,
    refetch: () => void query.refetch(),
  }
}
