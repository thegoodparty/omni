'use client'

import { useMemo } from 'react'
import type { ContactsLabels } from 'app/dashboard/shared/contactsLabels'
import type { ListShape } from 'app/dashboard/shared/listShapes'
import type { SegmentResponse } from '../shared/contacts-types'
import { useFilterPoints } from '../wizard/useFilterPoints'
import { groupCoordinates } from './contactListPoints'
import BoundaryDrawOverlay from './BoundaryDrawOverlay'

// A saved list's audience as it stands before its boundary narrows it: the
// row's own criteria with the shape taken off. The list's MEMBERS are the
// wrong dots to draw on — they are already cut down to the shapes, so a
// holder adding another one would see nobody outside the shapes they have.
//
// The row goes to the points endpoint as it is, rather than through the
// wizard's pill transform, because a saved list can hold criteria no pill
// expresses (the follow-up flag a results drawer saves, retired age buckets)
// and the endpoint already reads every column a saved list can carry. The
// columns that are not criteria are stripped server-side.
export const savedListAudienceFilters = (
  segment: SegmentResponse,
): Record<string, unknown> => {
  const {
    geoPoly: _geoPoly,
    geoPolyLabels: _geoPolyLabels,
    activityConditions,
    ...criteria
  } = segment
  return {
    ...criteria,
    ...(activityConditions?.length
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
}

interface ListBoundaryOverlayProps {
  segment: SegmentResponse
  initialShapes: ListShape[]
  labels: ContactsLabels
  isSaving: boolean
  onCancel: () => void
  onSave: (shapes: ListShape[]) => void
}

// A SAVED list's half of the drawing surface: the list's whole audience in,
// coordinates out. The surface itself is `BoundaryDrawOverlay`, shared with
// the wizard, which draws the audience it is building the same way.
export default function ListBoundaryOverlay({
  segment,
  initialShapes,
  labels,
  isSaving,
  onCancel,
  onSave,
}: ListBoundaryOverlayProps) {
  const filters = useMemo(() => savedListAudienceFilters(segment), [segment])
  const { points: rawPoints, truncated } = useFilterPoints(filters, true)
  const points = useMemo(() => groupCoordinates(rawPoints), [rawPoints])

  return (
    <BoundaryDrawOverlay
      points={points}
      truncated={truncated}
      // The points endpoint selects on lat/lng, so it cannot describe the
      // rows it dropped. See the known gap in contacts/AGENTS.md.
      unmappable={0}
      initialShapes={initialShapes}
      labels={labels}
      // The dots are the audience the save re-applies its criteria to, so
      // the count is what the list will hold unless the page was capped.
      isEstimate={truncated}
      isSaving={isSaving}
      onCancel={onCancel}
      onSave={onSave}
    />
  )
}
