import { useMemo, useState } from 'react'
import dynamic from 'next/dynamic'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { FetchError } from 'ofetch'
import { Button, CropIcon } from '@styleguide'
import { clientRequest } from 'gpApi/typed-request'
import { useOrganization } from '@shared/organization-picker'
import { useSnackbar } from 'helpers/useSnackbar'
import { EVENTS, trackEvent } from 'helpers/analyticsHelper'
import {
  ringFromGeoJsonPolygon,
  ringToGeoJsonPolygon,
  type PolygonRing,
} from 'app/dashboard/shared/ringGeometry'
import { getContactsLabels } from '../../../shared/contactsLabels'
import { useContactsTable } from '../ContactsTableProvider'
import { SectionLabel } from '../lists/ListDetailSection'
import { LOCKED_LIST_MESSAGE } from '../shared/constants'
import type { SegmentResponse } from '../shared/contacts-types'
import { useListPeople, listPeopleQueryKey } from './useListPeople'
import ListBoundaryOverlay from './ListBoundaryOverlay'

// maplibre-gl touches `window` at module scope, so the canvas cannot be part
// of the server bundle. The sheet this sits in is client-rendered either way;
// the dynamic import is about the canvas's own import graph, not this file's.
const ContactListMap = dynamic(() => import('./ContactListMap'), {
  ssr: false,
  loading: () => <MapFrame>Loading map…</MapFrame>,
})

const MapFrame = ({ children }: { children: React.ReactNode }) => (
  <div className="flex h-64 items-center justify-center rounded-md border bg-muted/30 text-sm text-muted-foreground">
    {children}
  </div>
)

export default function ListMapSection({
  segment,
}: {
  segment: SegmentResponse
}) {
  const listId = segment.id
  const { selectPerson, currentlySelectedPersonId, isWinContext } =
    useContactsTable()
  const { people, truncated, total, isLoading, isError } = useListPeople(listId)
  const { successSnackbar, errorSnackbar } = useSnackbar()
  const queryClient = useQueryClient()
  const orgSlug = useOrganization()?.slug
  const [drawing, setDrawing] = useState(false)

  const labels = getContactsLabels(isWinContext)
  const savedRing = useMemo(
    () => ringFromGeoJsonPolygon(segment.geoPoly),
    [segment.geoPoly],
  )
  const isLocked = Boolean(segment.firstUsedForOutreachAt)

  const saveMutation = useMutation({
    mutationFn: (ring: PolygonRing) =>
      clientRequest('PUT /v1/voters/voter-file/filter/:id', {
        id: String(listId),
        geoPoly: ringToGeoJsonPolygon(ring),
      }).then((res) => res.data),
    onSuccess: async (_data, ring) => {
      trackEvent(EVENTS.ConstituentData.ListBoundarySaved, {
        listId,
        cleared: ring.length < 3,
      })
      successSnackbar('List updated')
      setDrawing(false)
      // Who is in the list changed, so both the summary the sheet renders
      // and the members the map draws are stale.
      await queryClient.invalidateQueries({
        queryKey: ['custom-segments', orgSlug],
      })
      await queryClient.invalidateQueries({
        queryKey: ['list-detail', orgSlug, listId],
      })
      await queryClient.invalidateQueries({
        queryKey: listPeopleQueryKey(orgSlug, String(listId)),
      })
    },
    onError: async (error: unknown) => {
      // Outreach stamps firstUsedForOutreachAt atomically, so a list can lock
      // while this surface is open. Same neutral handling the wizard's update
      // gives that race, not an error toast.
      if (error instanceof FetchError && error.status === 409) {
        errorSnackbar(LOCKED_LIST_MESSAGE, { autoHideDuration: 6000 })
        setDrawing(false)
        await queryClient.invalidateQueries({
          queryKey: ['custom-segments', orgSlug],
        })
        return
      }
      errorSnackbar('Failed to update list')
    },
  })

  return (
    <div className="flex flex-col gap-2">
      <SectionLabel>Where they are</SectionLabel>
      {isLoading ? (
        <MapFrame>Loading map…</MapFrame>
      ) : isError ? (
        <MapFrame>This list could not be mapped right now.</MapFrame>
      ) : people.length === 0 ? (
        // An empty response means the list matches nobody, which is a
        // different thing from its members lacking coordinates. People with
        // no location still arrive here and are counted inside the map as
        // unmappable, so claiming "no location on file" at this branch
        // described a case that cannot reach it.
        <MapFrame>This list has no members yet.</MapFrame>
      ) : (
        <>
          <div className="h-64 overflow-hidden rounded-md border">
            <ContactListMap
              people={people}
              truncated={truncated}
              selectedPersonId={currentlySelectedPersonId}
              onSelectPerson={selectPerson}
              // No writer: a locked list still shows the geography it was
              // cut with, it just cannot be re-cut.
              drawRing={savedRing}
            />
          </div>
          {truncated ? (
            <p className="text-xs text-muted-foreground">
              Showing the first {people.length.toLocaleString()} of{' '}
              {total.toLocaleString()}.
            </p>
          ) : null}
          {!isLocked && (
            <Button
              type="button"
              variant="outline"
              size="small"
              className="self-start gap-2"
              onClick={() => setDrawing(true)}
            >
              <CropIcon className="size-4" aria-hidden />
              {savedRing.length >= 3
                ? labels.boundaryEditCta
                : labels.boundaryDrawCta}
            </Button>
          )}
          {drawing && (
            <ListBoundaryOverlay
              people={people}
              truncated={truncated}
              initialRing={savedRing}
              labels={labels}
              isSaving={saveMutation.isPending}
              onCancel={() => setDrawing(false)}
              onSave={(ring) => saveMutation.mutate(ring)}
            />
          )}
        </>
      )}
    </div>
  )
}
