import { useMutation, useQueryClient } from '@tanstack/react-query'
import { clientRequest } from 'gpApi/typed-request'
import { useOrganization } from '@shared/organization-picker'
import { useSnackbar } from 'helpers/useSnackbar'
import { trimCustomSegmentName } from '../shared/segments.util'
import type { SegmentResponse } from '../shared/contacts-types'
import { useContactsTable } from '../ContactsTableProvider'

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
  const { selectList } = useContactsTable()
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
    onSuccess: async (response) => {
      successSnackbar('List duplicated')
      await queryClient.invalidateQueries({
        queryKey: ['custom-segments', orgSlug],
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
