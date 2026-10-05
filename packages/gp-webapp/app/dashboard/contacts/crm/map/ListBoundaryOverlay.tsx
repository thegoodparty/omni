'use client'

import { useMemo } from 'react'
import type { ContactsLabels } from 'app/dashboard/shared/contactsLabels'
import { isDrawnShape, type ListShape } from 'app/dashboard/shared/listShapes'
import type { Person } from '../shared/contacts-types'
import { toContactPoints } from './contactListPoints'
import BoundaryDrawOverlay from './BoundaryDrawOverlay'

interface ListBoundaryOverlayProps {
  people: Person[]
  truncated: boolean
  initialShapes: ListShape[]
  labels: ContactsLabels
  isSaving: boolean
  onCancel: () => void
  onSave: (shapes: ListShape[]) => void
}

// A SAVED list's half of the drawing surface: person records in, coordinates
// out. The surface itself is `BoundaryDrawOverlay`, shared with the wizard,
// which has no records to hand it.
export default function ListBoundaryOverlay({
  people,
  truncated,
  initialShapes,
  labels,
  isSaving,
  onCancel,
  onSave,
}: ListBoundaryOverlayProps) {
  const { points, unmappable } = useMemo(
    () => toContactPoints(people),
    [people],
  )

  return (
    <BoundaryDrawOverlay
      points={points}
      truncated={truncated}
      unmappable={unmappable}
      initialShapes={initialShapes}
      labels={labels}
      // Truncated means the dots are a page of a longer list, and a boundary
      // already saved means they are the people it kept — either way the
      // running count describes what is drawn and not what will be saved.
      isEstimate={truncated || initialShapes.some(isDrawnShape)}
      isSaving={isSaving}
      onCancel={onCancel}
      onSave={onSave}
    />
  )
}
