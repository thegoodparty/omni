import { useMemo, useState } from 'react'
import dynamic from 'next/dynamic'
import { Button, CropIcon } from '@styleguide'
import { shapesFromSaved } from 'app/dashboard/shared/listShapes'
import { getContactsLabels } from '../../../shared/contactsLabels'
import { useContactsTable } from '../ContactsTableProvider'
import { SectionLabel } from '../lists/ListDetailSection'
import type { SegmentResponse } from '../shared/contacts-types'
import { useListPeople } from './useListPeople'
import { useSaveListBoundary } from './useSaveListBoundary'
import ListBoundaryOverlay from './ListBoundaryOverlay'
import ShapeLegend from './ShapeLegend'

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
  const [drawing, setDrawing] = useState(false)

  const labels = getContactsLabels(isWinContext)
  const savedShapes = useMemo(
    () => shapesFromSaved(segment.geoPoly, segment.geoPolyLabels),
    [segment.geoPoly, segment.geoPolyLabels],
  )
  // Stable for the map's layer effect, which lists both among its deps.
  const savedRings = useMemo(
    () => savedShapes.map((shape) => shape.ring),
    [savedShapes],
  )
  const savedColors = useMemo(
    () => savedShapes.map((shape) => shape.color),
    [savedShapes],
  )
  const isLocked = Boolean(segment.firstUsedForOutreachAt)

  const saveMutation = useSaveListBoundary(listId, 'listDetail', {
    onClose: () => setDrawing(false),
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
              // cut with, it just cannot be re-cut. Every part goes through
              // `otherRings`, which is the read-only layer — `drawRing` is
              // the part a gesture edits, and nothing here edits.
              otherRings={savedRings}
              otherRingColors={savedColors}
            />
          </div>
          <ShapeLegend shapes={savedShapes} />
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
              {savedShapes.length > 0
                ? labels.boundaryEditCta
                : labels.boundaryDrawCta}
            </Button>
          )}
          {drawing && (
            <ListBoundaryOverlay
              people={people}
              truncated={truncated}
              initialShapes={savedShapes}
              labels={labels}
              isSaving={saveMutation.isPending}
              onCancel={() => setDrawing(false)}
              onSave={(shapes) => saveMutation.mutate(shapes)}
            />
          )}
        </>
      )}
    </div>
  )
}
