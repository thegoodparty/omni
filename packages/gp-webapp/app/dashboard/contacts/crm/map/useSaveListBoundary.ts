import { useMutation, useQueryClient } from '@tanstack/react-query'
import { FetchError } from 'ofetch'
import { clientRequest } from 'gpApi/typed-request'
import { useOrganization } from '@shared/organization-picker'
import { useSnackbar } from 'helpers/useSnackbar'
import { EVENTS, trackEvent } from 'helpers/analyticsHelper'
import {
  drawnRings,
  ringsToGeoJsonShape,
  type PolygonRing,
} from 'app/dashboard/shared/ringGeometry'
import { LOCKED_LIST_MESSAGE } from '../shared/constants'
import { boundarySaveErrorMessage } from '../shared/boundarySaveError'
import { listPeopleQueryKey } from './useListPeople'

// Which screen the holder drew on. The act is the same and the write is the
// same, but "do they ever do this from the chat" is the question the second
// surface was built to answer, and it cannot be asked of a single event with
// no way to tell them apart.
export type BoundarySaveSurface = 'listDetail' | 'chat'

// Writing a drawn boundary onto a saved list, shared by the two surfaces
// that can draw one. Extracted rather than copied: every branch here is a
// rule about the same write — outreach can lock a list mid-draw (409), the
// unfiltered freeze scan can exceed its cap and the refusal's own wording is
// the only actionable thing in it, and three caches describe a list whose
// membership just changed. A second copy would drift on whichever of those
// the copier did not happen to be thinking about.
export const useSaveListBoundary = (
  listId: number,
  surface: BoundarySaveSurface,
  onSaved?: () => void,
) => {
  const { successSnackbar, errorSnackbar } = useSnackbar()
  const queryClient = useQueryClient()
  const orgSlug = useOrganization()?.slug

  return useMutation({
    mutationFn: (rings: PolygonRing[]) =>
      clientRequest('PUT /v1/voters/voter-file/filter/:id', {
        id: String(listId),
        geoPoly: ringsToGeoJsonShape(rings),
      }).then((res) => res.data),
    onSuccess: async (_data, rings) => {
      const drawn = drawnRings(rings)
      trackEvent(EVENTS.ConstituentData.ListBoundarySaved, {
        listId,
        cleared: drawn.length === 0,
        // How many parts the saved boundary has, so "do holders actually
        // draw more than one" is answerable without reading geometry back.
        shapeCount: drawn.length,
        surface,
      })
      successSnackbar('List updated')
      // Who is in the list changed, so both the summary the sheet renders
      // and the members the map draws are stale. The chat reads the list row
      // out of `custom-segments` too, so the first of these is what refreshes
      // the outline under a transcript's map.
      await queryClient.invalidateQueries({
        queryKey: ['custom-segments', orgSlug],
      })
      await queryClient.invalidateQueries({
        queryKey: ['list-detail', orgSlug, listId],
      })
      await queryClient.invalidateQueries({
        queryKey: listPeopleQueryKey(orgSlug, String(listId)),
      })
      // Last, for the reason the 409 branch below does the same: closing
      // hands the holder back a card that reads its ring and its lock out
      // of these caches, so closing first shows them the boundary they just
      // replaced. The mutation stays pending across these awaits, which is
      // honest — the save is not done until what everyone reads agrees.
      onSaved?.()
    },
    onError: async (error: unknown) => {
      // Outreach stamps firstUsedForOutreachAt atomically, so a list can lock
      // while this surface is open. Same neutral handling the wizard's update
      // gives that race, not an error toast.
      if (error instanceof FetchError && error.status === 409) {
        errorSnackbar(LOCKED_LIST_MESSAGE, { autoHideDuration: 6000 })
        // Refresh BEFORE closing. The surfaces that draw decide whether to
        // offer the button from this cache, and the row in it still says
        // unlocked — so closing first hands the holder back a card that
        // invites them to draw on the list they were just refused.
        await queryClient.invalidateQueries({
          queryKey: ['custom-segments', orgSlug],
        })
        onSaved?.()
        return
      }
      // The cap refusal reaches this surface too — a saved list's boundary
      // is frozen by the same unfiltered scan — and its wording is the only
      // thing that tells the holder to draw smaller.
      const capMessage = boundarySaveErrorMessage(error)
      if (capMessage) {
        errorSnackbar(capMessage, { autoHideDuration: 6000 })
        return
      }
      errorSnackbar('Failed to update list')
    },
  })
}
