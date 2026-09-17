import { useQuery } from '@tanstack/react-query'
import { FetchError } from 'ofetch'
import { clientRequest } from 'gpApi/typed-request'
import { MAX_RESULTS_PER_PAGE } from '@goodparty_org/contracts'
import { useOrganization } from '@shared/organization-picker'
import type { Person } from '../shared/contacts-types'

// Keyed with the org slug like every other contacts query. List ids are
// per-org integers, so two orgs can hold the same id: without the slug a
// cached list survives an org switch and the map draws the previous
// organization's named constituents at their real addresses.
export const listPeopleQueryKey = (
  orgSlug: string | undefined,
  segment: string | null,
) => ['list-people', orgSlug, segment] as const

// A map wants the whole list at once, not a page of it, so this asks for the
// largest page the route allows rather than paging. The cap is the route's
// own (MAX_RESULTS_PER_PAGE), shared through contracts so this cannot drift
// from what the server will accept.
//
// A list longer than the cap is truncated rather than paged: `truncated` says
// so, and the caller is expected to surface it. Silently drawing the first
// page of a longer list would show a map that looks complete and is not.
export interface ListPeopleResult {
  people: Person[]
  total: number
  truncated: boolean
  isLoading: boolean
  isError: boolean
}

export const useListPeople = (
  listId: string | number | null,
): ListPeopleResult => {
  const orgSlug = useOrganization()?.slug
  const segment = listId === null ? null : String(listId)
  const query = useQuery({
    queryKey: listPeopleQueryKey(orgSlug, segment),
    enabled: segment !== null,
    // Same suppression contactTableQueryOptions carries, for the same reason:
    // a contacts 4xx is deterministic (400 = VOTER_DATA_UNAVAILABLE, 403 =
    // not-pro), so retrying only makes an ineligible user wait out the full
    // backoff before the error state can render. This hook uses its own query
    // key, so it is not deduped against that one and needs its own copy.
    retry: (failureCount, error) =>
      !(
        error instanceof FetchError &&
        typeof error.status === 'number' &&
        error.status >= 400 &&
        error.status < 500
      ) && failureCount < 2,
    queryFn: () =>
      clientRequest('GET /v1/contacts', {
        segment: segment!,
        page: 1,
        resultsPerPage: MAX_RESULTS_PER_PAGE,
      }).then((res) => res.data),
  })

  const people = (query.data?.people as Person[]) ?? []
  const total = query.data?.pagination?.totalResults ?? people.length

  return {
    people,
    total,
    truncated: total > people.length,
    isLoading: query.isPending && segment !== null,
    isError: query.isError,
  }
}
