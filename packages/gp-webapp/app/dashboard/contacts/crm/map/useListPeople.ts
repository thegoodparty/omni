import { useQuery } from '@tanstack/react-query'
import { clientRequest } from 'gpApi/typed-request'
import { MAX_RESULTS_PER_PAGE } from '@goodparty_org/contracts'
import type { Person } from '../shared/contacts-types'

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
  const segment = listId === null ? null : String(listId)
  const query = useQuery({
    queryKey: ['list-people', segment],
    enabled: segment !== null,
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
