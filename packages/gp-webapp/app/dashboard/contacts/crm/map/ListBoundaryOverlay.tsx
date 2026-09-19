'use client'

import { useMemo, useState } from 'react'
import { Button } from '@styleguide'
import type { ContactsLabels } from 'app/dashboard/shared/contactsLabels'
import {
  isPointInRing,
  type PolygonRing,
} from 'app/dashboard/shared/ringGeometry'
import type { Person } from '../shared/contacts-types'
import { toContactPoints } from './contactListPoints'
import BoundaryDrawPanel from './BoundaryDrawPanel'

interface ListBoundaryOverlayProps {
  people: Person[]
  truncated: boolean
  initialRing: PolygonRing
  labels: ContactsLabels
  isSaving: boolean
  onCancel: () => void
  onSave: (ring: PolygonRing) => void
}

// The full-bleed drawing surface a saved list's map opens into. It owns the
// in-progress ring so cancelling leaves the list exactly as it was, and
// hands the finished one back on save.
export default function ListBoundaryOverlay({
  people,
  truncated,
  initialRing,
  labels,
  isSaving,
  onCancel,
  onSave,
}: ListBoundaryOverlayProps) {
  const [ring, setRing] = useState<PolygonRing>(initialRing)

  const { points, unmappable } = useMemo(
    () => toContactPoints(people),
    [people],
  )

  // Ray-cast over the dots on screen rather than asked of the server: it
  // answers on every drag of a handle, and it answers for exactly the shape
  // being dragged. The server settles it on save.
  const inside = useMemo(
    () =>
      ring.length < 3
        ? 0
        : points.reduce(
            (total, point) =>
              isPointInRing(point.lng, point.lat, ring)
                ? total + point.residents.length
                : total,
            0,
          ),
    [points, ring],
  )

  // Truncated means the dots are a page of a longer list, and a boundary
  // already saved means they are the people it kept — either way the number
  // below describes what is drawn and not what will be saved.
  const isEstimate = truncated || initialRing.length >= 3
  const hasRing = ring.length >= 3

  return (
    <div
      className="fixed inset-0 z-[1400] flex flex-col bg-background"
      data-testid="boundary-overlay"
    >
      <BoundaryDrawPanel
        points={points}
        truncated={truncated}
        ring={ring}
        onRingChange={setRing}
        pillLabel={labels.boundaryCountLabel(inside)}
        hint={labels.boundaryStepHint}
        className="min-h-0 flex-1"
      />
      <div className="border-t border-border bg-background px-6 py-4">
        <div className="mx-auto flex w-full max-w-[608px] flex-col gap-2">
          {hasRing && inside === 0 ? (
            <p className="text-sm text-foreground" aria-live="polite">
              {labels.boundaryEmptyShape}
            </p>
          ) : hasRing && isEstimate ? (
            <p className="text-xs text-muted-foreground">
              {labels.boundaryEstimateNote}
            </p>
          ) : null}
          {unmappable > 0 && (
            <p className="text-xs text-muted-foreground">
              {labels.boundaryUnmappable(unmappable)}
            </p>
          )}
          <div className="flex flex-row-reverse items-center justify-between gap-3">
            <Button
              type="button"
              size="large"
              className="min-w-0 flex-1 lg:min-w-[240px] lg:flex-none"
              disabled={hasRing && inside === 0}
              loading={isSaving}
              onClick={() => onSave(ring)}
            >
              Save
            </Button>
            <Button
              type="button"
              size="large"
              variant="ghost"
              className="shrink-0 lg:min-w-[140px]"
              onClick={onCancel}
            >
              Cancel
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
