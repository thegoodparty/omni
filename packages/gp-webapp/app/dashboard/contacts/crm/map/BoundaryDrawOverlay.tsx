import dynamic from 'next/dynamic'
import { useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  Button,
  Dialog,
  DialogContent,
  DialogTitle,
  Undo2Icon,
} from '@styleguide'
import type { ContactsLabels } from 'app/dashboard/shared/contactsLabels'
import {
  isPointInAnyRing,
  isPointInRing,
  type PolygonRing,
} from 'app/dashboard/shared/ringGeometry'
import {
  isDrawnShape,
  nextShapeColor,
  nextShapeName,
  type ListShape,
} from 'app/dashboard/shared/listShapes'
import type { ContactPoint } from './contactListPoints'
import { DIALOG_LAYER, ListShapePanel } from './ListShapePanel'

// maplibre-gl touches `window` at module scope, so the canvas cannot be part
// of the server bundle — the same reason ListMapSection loads it this way.
const ContactListMap = dynamic(() => import('./ContactListMap'), {
  ssr: false,
  loading: () => (
    <div className="flex h-full w-full items-center justify-center text-sm text-muted-foreground">
      Loading map…
    </div>
  ),
})

// The count pill and Undo's own height plus a dot's worth of clearance, so
// the opening fit frames every point above them.
const MAP_CHROME_INSET_PX = 76

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
  // The shapes this surface opens on. Empty for a list with none.
  initialShapes: ListShape[]
  // The shape under the cursor when the surface opens, for a caller that
  // was asked to edit one in particular. Defaults to the last one cut.
  initialActiveIndex?: number
  labels: ContactsLabels
  // Whether the running count describes something other than what the save
  // will measure — a truncated page of dots, or a list already narrowed by
  // a shape. The caller decides because only it knows where its dots
  // came from.
  isEstimate: boolean
  // Whether a boundary holding none of the dots on screen may still be
  // handed back. The saved-list surfaces write immediately, so a boundary
  // that catches nobody is a save with nothing behind it and they refuse
  // it. The wizard asks gp-api about the same shapes on the step behind
  // this one and blocks Continue on THAT answer.
  allowEmptyShape?: boolean
  isSaving: boolean
  onCancel: () => void
  onSave: (shapes: ListShape[]) => void
}

const residentsInside = (points: ContactPoint[], rings: PolygonRing[]) =>
  rings.length === 0
    ? 0
    : points.reduce(
        (total, point) =>
          isPointInAnyRing(point.lng, point.lat, rings)
            ? total + point.residents.length
            : total,
        0,
      )

// The full-bleed drawing surface every boundary entry point opens into: the
// list detail sheet, the Chief of Staff transcript, and the create-list
// wizard. Laid out the way door knocking cuts turfs — the map, with a panel
// of named, coloured shapes docked beside it at `lg` and a bottom sheet over
// it below. It owns the shapes in progress so cancelling leaves the caller
// exactly as it was, and hands the finished set back on save.
export default function BoundaryDrawOverlay({
  points,
  truncated,
  unmappable,
  initialShapes,
  initialActiveIndex,
  labels,
  isEstimate,
  allowEmptyShape = false,
  isSaving,
  onCancel,
  onSave,
}: BoundaryDrawOverlayProps) {
  // Asked to open past the last shape is asked for a new one, so it opens
  // on an empty card ready to draw into. Not on a list with no shapes yet:
  // that one opens on the panel's empty state, which is what introduces
  // the first.
  const [shapes, setShapes] = useState<ListShape[]>(() =>
    initialShapes.length > 0 && initialActiveIndex === initialShapes.length
      ? [
          ...initialShapes,
          {
            name: nextShapeName(initialShapes),
            color: nextShapeColor(initialShapes),
            ring: [],
          },
        ]
      : initialShapes,
  )
  const [activeIndex, setActiveIndex] = useState(
    initialActiveIndex ?? initialShapes.length - 1,
  )
  const [chromeBottomPx, setChromeBottomPx] = useState<number | null>(16)
  const [discardOpen, setDiscardOpen] = useState(false)
  // The fit reads this once, at the size the panel opened at. Re-fitting as
  // the sheet is dragged would yank the camera out from under a holder who
  // has already aimed it.
  const [fitInsetPx] = useState(() =>
    typeof window === 'undefined' ||
    window.matchMedia('(min-width: 1024px)').matches
      ? MAP_CHROME_INSET_PX
      : Math.round(window.innerHeight * 0.5) + MAP_CHROME_INSET_PX,
  )

  // Radix restores focus when a dialog transitions open -> closed. Every
  // caller mounts this conditionally, so it never makes that transition —
  // it is simply unmounted, and Radix's restore never runs.
  const openerRef = useRef<HTMLElement | null>(null)
  if (openerRef.current === null && typeof document !== 'undefined') {
    openerRef.current = document.activeElement as HTMLElement | null
  }
  useEffect(() => () => openerRef.current?.focus?.(), [])

  const active = shapes[activeIndex]
  const drawn = shapes.filter(isDrawnShape)
  // Ray-cast over the dots on screen rather than asked of the server: it
  // answers on every drag of a handle. Across every shape, counting each
  // person once — a dot inside two overlapping shapes adds its residents
  // once, which is the whole reason shapes are allowed to overlap.
  const inside = useMemo(
    () =>
      residentsInside(
        points,
        shapes.filter(isDrawnShape).map((shape) => shape.ring),
      ),
    [points, shapes],
  )
  const shapeCounts = useMemo(
    () =>
      shapes.map((shape) =>
        labels.boundaryShapeCount(
          points.reduce(
            (total, point) =>
              isPointInRing(point.lng, point.lat, shape.ring)
                ? total + point.residents.length
                : total,
            0,
          ),
        ),
      ),
    [points, shapes, labels],
  )

  const hasRing = drawn.length > 0
  // Over finished shapes only: an empty card opened for drawing into is not
  // a change anybody has to be asked about discarding.
  const dirty =
    JSON.stringify(drawn) !== JSON.stringify(initialShapes.filter(isDrawnShape))

  // Every way out — Cancel, Escape — asks first when there is something to
  // lose, so no key throws shapes away that the button would have asked
  // about.
  const requestCancel = () => (dirty ? setDiscardOpen(true) : onCancel())

  const writeActiveRing = (ring: PolygonRing) => {
    if (active) {
      setShapes(
        shapes.map((shape, index) =>
          index === activeIndex ? { ...shape, ring } : shape,
        ),
      )
      return
    }
    // A tap with no shape to put it in starts the first one, so the map
    // never swallows a corner.
    setShapes([
      ...shapes,
      {
        name: nextShapeName(shapes),
        color: nextShapeColor(shapes),
        ring,
      },
    ])
    setActiveIndex(shapes.length)
  }

  const addShape = () => {
    setShapes([
      ...shapes,
      {
        name: nextShapeName(shapes),
        color: nextShapeColor(shapes),
        ring: [],
      },
    ])
    setActiveIndex(shapes.length)
  }

  // Hands the cursor to the shape cut before it, never to a fresh one, the
  // same way door knocking hands back a deleted turf's cursor.
  const removeShape = (index: number) => {
    const remaining = shapes.filter((_, i) => i !== index)
    setShapes(remaining)
    setActiveIndex((current) => {
      if (current !== index) return current > index ? current - 1 : current
      return remaining.length === 0 ? -1 : Math.max(0, index - 1)
    })
  }

  const updateActive = (patch: Partial<ListShape>) =>
    setShapes(
      shapes.map((shape, index) =>
        index === activeIndex ? { ...shape, ...patch } : shape,
      ),
    )

  const otherShapes = shapes.filter((_, index) => index !== activeIndex)

  const notes =
    hasRing && inside === 0 ? (
      <p className="text-sm text-foreground" aria-live="polite">
        {labels.boundaryEmptyShape}
      </p>
    ) : (
      <>
        {hasRing && isEstimate && (
          <p className="text-xs text-muted-foreground">
            {labels.boundaryEstimateNote}
          </p>
        )}
        {unmappable > 0 && (
          <p className="text-xs text-muted-foreground">
            {labels.boundaryUnmappable(unmappable)}
          </p>
        )}
      </>
    )

  return (
    <Dialog open onOpenChange={(next) => !next && requestCancel()}>
      {/* Full-bleed rather than the centred card DialogContent defaults to:
          `sm:max-w-none` is NOT redundant beside `max-w-none` — the base
          component carries `sm:max-w-lg`, and a responsive variant wins over
          a plain utility in the cascade. z-[1400] because every caller opens
          it from inside a drawer. The last-child hide drops the built-in
          close — Cancel is the close here, and two of them invite the holder
          to guess which one discards their shapes. */}
      <DialogContent
        className="flex h-dvh max-h-none w-screen max-w-none translate-x-0 translate-y-0 flex-row gap-0 rounded-none border-0 p-0 top-0 left-0 z-[1400] sm:max-w-none [&>button:last-child]:hidden"
        data-testid="boundary-overlay"
        onEscapeKeyDown={(event) => {
          event.preventDefault()
          // Escape in a name field abandons the rename, and nothing more.
          const target = event.target as HTMLElement | null
          if (target?.closest('input, textarea')) return
          requestCancel()
        }}
      >
        <DialogTitle className="sr-only">{labels.boundaryDrawCta}</DialogTitle>
        <div className="relative min-h-0 min-w-0 flex-1 overflow-hidden">
          <ContactListMap
            contactPoints={points}
            truncated={truncated}
            bottomInsetPx={fitInsetPx}
            drawRing={active?.ring ?? []}
            drawColor={active?.color ?? nextShapeColor(shapes)}
            otherRings={otherShapes.map((shape) => shape.ring)}
            otherRingColors={otherShapes.map((shape) => shape.color)}
            onDrawRingChange={writeActiveRing}
          />
          {/* Feedback on the gesture stays on the map, next to the shape it
              is about; everything about WHICH shape lives in the panel.
              z-10 because the deck.gl canvas paints into its own stacking
              context and would otherwise draw dots over these controls. */}
          {shapes.some((shape) => shape.ring.length > 0) &&
            chromeBottomPx !== null && (
              <div
                className="pointer-events-none absolute inset-x-0 z-10 flex justify-center px-4"
                style={{ bottom: chromeBottomPx }}
              >
                <div className="pointer-events-auto flex items-center gap-2">
                  {hasRing && (
                    <span className="inline-flex h-9 items-center rounded-full border border-border bg-card px-3.5 text-sm font-semibold text-foreground shadow-sm">
                      {labels.boundaryCountLabel(inside, drawn.length)}
                    </span>
                  )}
                  <Button
                    type="button"
                    variant="outline"
                    size="small"
                    className="bg-card hover:bg-card"
                    disabled={!active || active.ring.length === 0}
                    onClick={() =>
                      active && updateActive({ ring: active.ring.slice(0, -1) })
                    }
                  >
                    <Undo2Icon className="size-4" />
                    Undo
                  </Button>
                </div>
              </div>
            )}
        </div>
        <ListShapePanel
          shapes={shapes}
          activeIndex={activeIndex}
          shapeCounts={shapeCounts}
          onSelect={setActiveIndex}
          onAdd={addShape}
          onRemove={removeShape}
          onRename={(name) => updateActive({ name })}
          onPickColor={(color) => updateActive({ color })}
          onSave={() => onSave(shapes.filter(isDrawnShape))}
          onCancel={requestCancel}
          isSaving={isSaving}
          saveBlocked={!allowEmptyShape && hasRing && inside === 0}
          notes={notes}
          onMapControlsOffsetChange={setChromeBottomPx}
        />
        <AlertDialog open={discardOpen} onOpenChange={setDiscardOpen}>
          <AlertDialogContent
            className={DIALOG_LAYER}
            overlayClassName={DIALOG_LAYER}
          >
            <AlertDialogHeader>
              <AlertDialogTitle>Discard your changes?</AlertDialogTitle>
              <AlertDialogDescription>
                The shapes will go back to how they were when you opened the
                map.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Keep drawing</AlertDialogCancel>
              <AlertDialogAction variant="destructive" onClick={onCancel}>
                Discard
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </DialogContent>
    </Dialog>
  )
}
