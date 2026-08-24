import { useMutation, useQueryClient } from '@tanstack/react-query'
import { clientRequest } from 'gpApi/typed-request'
import { useOrganization } from '@shared/organization-picker'
import { EVENTS, trackEvent } from 'helpers/analyticsHelper'
import { useSnackbar } from 'helpers/useSnackbar'
import { trimCustomSegmentName } from '../shared/segments.util'
import type { SegmentResponse } from '../shared/contacts-types'
import { useContactsTable } from '../ContactsTableProvider'
import { outreachAudienceListsKey } from 'app/dashboard/outreach/v2/audience/useOutreachAudience'

// "List-from-list is filter composition at creation time" (locked design):
// duplicate reposts the segment's own demographic/activity criteria as a new
// create call, named "<original> (copy)". Always available, locked or not —
// it's the prescribed way to edit a locked list's criteria. Only the fields
// CreateVoterFileFilterSchema accepts are forwarded; server-only fields
// (id, timestamps, organizationSlug, firstUsedForOutreachAt) are stripped,
// and each activityConditions entry is narrowed to
// { outreachType, outreachId, actions } (its own id/voterFileFilterId are
// server-only too).
export const useDuplicateList = () => {
  const { selectList, isWinContext, isWinContextReady } = useContactsTable()
  const orgSlug = useOrganization()?.slug
  const queryClient = useQueryClient()
  const { successSnackbar, errorSnackbar } = useSnackbar()

  const mutation = useMutation({
    mutationFn: (segment: SegmentResponse) => {
      const {
        id: _id,
        name,
        firstUsedForOutreachAt: _firstUsedForOutreachAt,
        activityConditions,
        voterCount: _voterCount,
        createdAt: _createdAt,
        updatedAt: _updatedAt,
        organizationSlug: _organizationSlug,
        ...rest
      } = segment

      const payload: Record<string, unknown> = {
        ...rest,
        name: trimCustomSegmentName(`${name || 'List'} (copy)`),
        ...(activityConditions
          ? {
              activityConditions: activityConditions.map(
                ({ outreachType, outreachId, actions }) => ({
                  outreachType,
                  outreachId,
                  actions,
                }),
              ),
            }
          : {}),
      }

      return clientRequest('POST /v1/voters/voter-file/filter', payload).then(
        (res) => res.data,
      )
    },
    onSuccess: (response) => {
      // ENG-10767: a duplicate creates a segment, so it rides the existing
      // Segment Created event with source: 'duplicate' (the wizard's
      // product-specific List Created events stay a pure wizard-outcome
      // metric). Ready-gated like the surface's other events.
      if (isWinContextReady) {
        trackEvent(EVENTS.Contacts.SegmentCreated, {
          source: 'duplicate',
          context: isWinContext ? 'win' : 'serve',
        })
      }
      successSnackbar('List duplicated')
      // ENG-10777: the detail sheet fetches the copy by id and doesn't need
      // the index cache, so navigate immediately rather than waiting on it —
      // react-query's mutation state machine awaits the whole onSuccess
      // callback before flipping isPending false (query-core's execute()
      // awaits options.onSuccess before dispatching "success"), so an
      // awaited invalidateQueries here previously left both the navigation
      // and the button's own loading state hostage to a slow index refetch.
      // Seed the cache with the copy (the POST response is a full
      // SegmentResponse) before navigating: ListDetailSheet reads this exact
      // key for its own segment lookup, and without this it briefly renders
      // "This list couldn't be found" off the stale cache until the
      // invalidation's background refetch lands — trading the old bug for a
      // false "deleted" flash on a slow connection. invalidateQueries below
      // still reconciles with the server's canonical list; it never rejects
      // (query-core catches each refetch's error internally), so not
      // awaiting it can't produce an unhandled rejection.
      queryClient.setQueryData<SegmentResponse[]>(
        ['custom-segments', orgSlug],
        (existing) => (existing ? [...existing, response] : existing),
      )
      queryClient.invalidateQueries({
        queryKey: ['custom-segments', orgSlug],
      })
      // Same endpoint backs the outreach audience picker's list cache; surface
      // the duplicate there too.
      queryClient.invalidateQueries({
        queryKey: outreachAudienceListsKey(orgSlug),
      })
      // Shallow (ENG-10725): opens the copy's detail sheet over the index.
      selectList(response.id)
    },
    onError: () => {
      errorSnackbar('Failed to duplicate list')
    },
  })

  return mutation
}
