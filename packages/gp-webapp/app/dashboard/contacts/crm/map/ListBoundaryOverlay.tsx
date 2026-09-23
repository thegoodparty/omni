'use client'

import { useMemo } from 'react'
import type { ContactsLabels } from 'app/dashboard/shared/contactsLabels'
import type { PolygonRing } from 'app/dashboard/shared/ringGeometry'
import type { Person } from '../shared/contacts-types'
import { toContactPoints } from './contactListPoints'
import BoundaryDrawOverlay from './BoundaryDrawOverlay'

interface ListBoundaryOverlayProps {
  people: Person[]
  truncated: boolean
  initialRing: PolygonRing
  labels: ContactsLabels
  isSaving: boolean
  onCancel: () => void
  onSave: (ring: PolygonRing) => void
}

// A SAVED list's half of the drawing surface: person records in, coordinates
// out. The surface itself is `BoundaryDrawOverlay`, shared with the wizard,
// which has no records to hand it.
export default function ListBoundaryOverlay({
  people,
  truncated,
  initialRing,
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
      initialRing={initialRing}
      labels={labels}
      // Truncated means the dots are a page of a longer list, and a boundary
      // already saved means they are the people it kept — either way the
      // running count describes what is drawn and not what will be saved.
      isEstimate={truncated || initialRing.length >= 3}
      isSaving={isSaving}
      onCancel={onCancel}
      onSave={onSave}
    />
  )
}
