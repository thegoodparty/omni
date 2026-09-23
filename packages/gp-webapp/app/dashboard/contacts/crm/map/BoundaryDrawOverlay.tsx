import { useEffect, useMemo, useRef, useState } from 'react'
import { Button, Dialog, DialogContent, DialogTitle } from '@styleguide'
import type { ContactsLabels } from 'app/dashboard/shared/contactsLabels'
import {
  drawnRings,
  isPointInAnyRing,
  type PolygonRing,
} from 'app/dashboard/shared/ringGeometry'
import type { ContactPoint } from './contactListPoints'
import BoundaryDrawPanel from './BoundaryDrawPanel'

interface BoundaryDrawOverlayProps {
  // Coordinates, not people: the surface behind these dots differs per
  // caller (a saved list has person records, the wizard has bare points),
  // and the overlay reads neither.
  points: ContactPoint[]
  truncated: boolean
  // People the dots cannot place. Zero where the caller asked for
  // coordinates rather than records — the points endpoint selects on
  // lat/lng, so it cannot describe the rows it dropped.
  unmappable: number
  // Every part of the boundary this surface opens on. Empty for a list with
  // none; one part for a list saved before a boundary could have several.
  initialRings: PolygonRing[]
  labels: ContactsLabels
  // Whether the running count describes something other than what the save
  // will measure — a truncated page of dots, or a list already narrowed by
  // a shape. The caller decides because only it knows where its dots
  // came from.
  isEstimate: boolean
  // Whether a shape holding none of the dots on screen may still be handed
  // back. The saved-list surfaces write immediately, so a ring that catches
  // nobody is a save with nothing behind it and they refuse it. The wizard
  // asks gp-api about the same shape on the step behind this one and blocks
  // Continue on THAT answer, so refusing here would be a client ray-cast
  // over a partial page of dots overruling the authority.
  allowEmptyShape?: boolean
  isSaving: boolean
  onCancel: () => void
  onSave: (rings: PolygonRing[]) => void
}

// The full-bleed drawing surface every boundary entry point opens into: the
// list detail sheet, the Chief of Staff transcript, and the create-list
// wizard. It owns the in-progress ring so cancelling leaves the caller
// exactly as it was, and hands the finished one back on save.
export default function BoundaryDrawOverlay({
  points,
  truncated,
  unmappable,
  initialRings,
  labels,
  isEstimate,
  allowEmptyShape = false,
  isSaving,
  onCancel,
  onSave,
}: BoundaryDrawOverlayProps) {
  // Always at least one part, so the map has somewhere to put the next
  // corner and the panel never renders an out-of-range active index.
  const [rings, setRings] = useState<PolygonRing[]>(
    initialRings.length > 0 ? initialRings : [[]],
  )
  // The part a returning holder is most likely to want under the cursor is
  // the one they cut last.
  const [activeIndex, setActiveIndex] = useState(
    Math.max(0, initialRings.length - 1),
  )

  // Radix restores focus when a dialog transitions open -> closed. Every
  // caller mounts this conditionally, so it never makes that transition —
  // it is simply unmounted, and Radix's restore never runs. Everything else
  // it gives us (the focus trap, aria-hiding the page behind, Escape) works
  // regardless; only the hand-back needs doing here.
  const openerRef = useRef<HTMLElement | null>(null)
  if (openerRef.current === null && typeof document !== 'undefined') {
    openerRef.current = document.activeElement as HTMLElement | null
  }
  useEffect(() => () => openerRef.current?.focus?.(), [])

  // Ray-cast over the dots on screen rather than asked of the server: it
  // answers on every drag of a handle, and it answers for exactly the shape
  // being dragged. The server settles it once the shape is handed back.
  // Across every part, counting each person once — a dot inside two
  // overlapping parts adds its residents once, not twice, which is the whole
  // reason the boundary is allowed parts that overlap.
  const inside = useMemo(() => {
    const drawn = drawnRings(rings)
    return drawn.length === 0
      ? 0
      : points.reduce(
          (total, point) =>
            isPointInAnyRing(point.lng, point.lat, drawn)
              ? total + point.residents.length
              : total,
          0,
        )
  }, [points, rings])

  const hasRing = drawnRings(rings).length > 0

  return (
    <Dialog open onOpenChange={(next) => !next && onCancel()}>
      {/* Full-bleed rather than the centred card DialogContent defaults to:
          `sm:max-w-none` is NOT redundant beside `max-w-none` — the base
          component carries `sm:max-w-lg`, and a responsive variant wins over
          a plain utility in the cascade, so without it this renders 512px
          wide on every screen above the sm breakpoint.
          the whole point of this surface is a map big enough to aim at.
          z-[1400] because every caller opens it from inside a drawer. The
          last-child hide is the styleguide's own idiom for dropping the
          built-in close (ModalOrDrawer uses it) — Cancel is the close here,
          and two of them invite the holder to guess which one discards
          their ring. */}
      <DialogContent
        className="flex h-dvh max-h-none w-screen max-w-none translate-x-0 translate-y-0 flex-col gap-0 rounded-none border-0 p-0 top-0 left-0 z-[1400] sm:max-w-none [&>button:last-child]:hidden"
        data-testid="boundary-overlay"
      >
        <DialogTitle className="sr-only">{labels.boundaryDrawCta}</DialogTitle>
        <BoundaryDrawPanel
          points={points}
          truncated={truncated}
          rings={rings}
          activeIndex={activeIndex}
          onRingsChange={setRings}
          onActiveIndexChange={setActiveIndex}
          pillLabel={labels.boundaryCountLabel(
            inside,
            drawnRings(rings).length,
          )}
          hint={labels.boundaryStepHint}
          editHint={labels.boundaryEditShapeHint}
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
                disabled={!allowEmptyShape && hasRing && inside === 0}
                loading={isSaving}
                onClick={() => onSave(rings)}
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
      </DialogContent>
    </Dialog>
  )
}
