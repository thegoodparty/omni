import { useQuery } from '@tanstack/react-query'
import { clientRequest } from 'gpApi/typed-request'
import { useOrganization } from '@shared/organization-picker'
import type { SegmentResponse } from '../shared/contacts-types'

// One saved list's own row, for a surface that holds an id and nothing else.
//
// Reads the whole `voter-file/filters` collection under the key
// ContactsTableProvider already uses, rather than fetching the list by id.
// That is the point: `useSaveListBoundary` invalidates
// `['custom-segments', orgSlug]` on every write, so a boundary saved
// anywhere refreshes the outline under a transcript's map with no second
// invalidation to remember. Fetching by id would have needed its own key and
// its own place in that list, which is how two surfaces start disagreeing
// about the same list.
//
// The chief-of-staff page does not mount ContactsTableProvider, so this
// cannot read the provider's copy — it shares the cache entry, not the
// context.
export const useSavedList = (
  listId: number | null,
): { list: SegmentResponse | undefined; isLoading: boolean } => {
  const orgSlug = useOrganization()?.slug
  const query = useQuery({
    queryKey: ['custom-segments', orgSlug],
    queryFn: () =>
      clientRequest('GET /v1/voters/voter-file/filters', {}).then(
        (res) => res.data,
      ),
    enabled: listId !== null && Boolean(orgSlug),
  })

  return {
    list: query.data?.find((segment) => segment.id === listId),
    // A disabled query stays isPending forever, so reading isPending alone
    // would spin before the org resolves — and reading it without the org
    // would report an unresolved list as a missing one.
    isLoading: listId !== null && (!orgSlug || query.isPending),
  }
}
