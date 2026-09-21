'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
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
// Everything in the overlay that a Tab can land on. Queried live on each
// keypress rather than cached: the panel's own chrome changes as a ring is
// drawn — Undo and Clear only exist once there is one — so a list captured
// at mount goes stale on the first corner placed.
const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), ' +
  'select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

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
  const containerRef = useRef<HTMLDivElement>(null)

  // This covers the whole viewport with an opaque background, so nothing
  // behind it can be clicked — but it declared itself no kind of dialog and
  // trapped no focus, so a Tab walked straight out of it into a page the
  // holder could not see. On the chat surface that reachable page includes
  // other maps' draw buttons, which remount this overlay and discard the
  // ring being drawn.
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    containerRef.current?.focus()
    return () => previous?.focus?.()
  }, [])

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    // Escape is Cancel, which is a labelled button three inches away doing
    // exactly this. Discarding an unsaved ring is what Cancel is FOR, so
    // this is not the silent loss the remount cases were.
    if (event.key === 'Escape') {
      event.stopPropagation()
      onCancel()
      return
    }
    if (event.key !== 'Tab') return
    const focusable = Array.from(
      containerRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [],
    )
    if (focusable.length === 0) return
    const first = focusable[0]!
    const last = focusable[focusable.length - 1]!
    const active = document.activeElement
    // Focus opens on the CONTAINER, which is tabbable only programmatically
    // and is in none of these lists. Comparing it against `first` therefore
    // said "not at the edge" and let the very first Shift+Tab walk straight
    // out of the dialog — the exact escape this exists to prevent, on the
    // one keystroke most likely to be tried.
    const insideList = focusable.some((node) => node === active)
    if (!insideList) {
      event.preventDefault()
      ;(event.shiftKey ? last : first).focus()
      return
    }
    // Wrap at both ends. Without the first branch a Shift+Tab off the front
    // leaves just as surely as a Tab off the back.
    if (event.shiftKey && active === first) {
      event.preventDefault()
      last.focus()
    } else if (!event.shiftKey && active === last) {
      event.preventDefault()
      first.focus()
    }
  }

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
      ref={containerRef}
      role="dialog"
      aria-modal="true"
      aria-label={labels.boundaryDrawCta}
      tabIndex={-1}
      onKeyDown={onKeyDown}
      className="fixed inset-0 z-[1400] flex flex-col bg-background outline-none"
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
