import { useEffect, useRef, useState } from 'react'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  Button,
  IconButton,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  Undo2Icon,
} from '@styleguide'

interface DrawFullScreenProps {
  // Boundary points placed so far. The canvas only emits a ring from three, so
  // this is the only thing that knows there is a one- or two-point shape.
  pointCount: number
  continueDisabled: boolean
  onContinue: () => void
  onClose: () => void
  // Drop the most recently placed vertex. Only fired when the Undo button is
  // on screen (pointCount > 0), so the zero-point case is structurally
  // impossible and needs no toast/shake feedback.
  onUndoPoint: () => void
  // Draw-stop count for the pill that sits beside Undo.
  drawStopCount: number
  // Whether the shape is over the 150-stop cap; the pill turns red and shakes
  // on a new tap that keeps it over.
  drawStopsOverCap: boolean
}

// The canvas's `dkDrawFullScreen`: the map, uncovered, with chrome floating
// over it. Everything is `pointer-events-none` except the controls, so every
// tap that is not on one of them reaches the map and places a vertex.
//
// The pre-first-point hint and the Undo + count pill share one slot above the
// footer, mutually exclusive on `pointCount`:
//   - 0 points → the centred hint pill names the gesture.
//   - ≥1 point → the hint disappears; Undo and the "N selected" pill take its
//     place in the same slot as one horizontal pair.
// Undoing back to 0 restores the hint. Because Undo only renders when there
// is a point to drop, there is no zero-point path to feed back — no toast,
// no shake on the button itself. The pill still shakes when a new tap keeps
// the shape over the 150-stop cap.
//
// The stats, the walk estimate, the cap warnings and the addresses panel are
// NOT here — the canvas puts its counts on the step behind this one, and so do
// we. This surface is the map and the way forward from it.
//
// The instructions dialog is seeded open on every mount rather than
// remembered: this surface unmounts on leave, so re-entering re-fires the
// initial state and the drawing rules are stated again without a "show me
// again" toggle to build for.
export const DrawFullScreen = ({
  pointCount,
  continueDisabled,
  onContinue,
  onClose,
  onUndoPoint,
  drawStopCount,
  drawStopsOverCap,
}: DrawFullScreenProps) => {
  const [instructionsOpen, setInstructionsOpen] = useState(true)
  const pillRef = useRef<HTMLSpanElement>(null)
  const prevStopsRef = useRef(drawStopCount)
  useEffect(() => {
    const previous = prevStopsRef.current
    prevStopsRef.current = drawStopCount
    // Shake on every change that lands the count over cap, in either
    // direction — 165→160 is still over the limit, and the point of
    // the shake is to keep saying so with every tap until the shape
    // gets under it.
    if (!drawStopsOverCap || drawStopCount === previous) return
    const el = pillRef.current
    if (!el) return
    el.classList.remove('animate-shake')
    // Reflow: React seeing the same class on re-render will not restart
    // the CSS animation, so the class has to go away and come back with
    // a layout between the two writes.
    void el.offsetWidth
    el.classList.add('animate-shake')
  }, [drawStopCount, drawStopsOverCap])

  return (
    <div className="pointer-events-none absolute inset-0 z-20">
      {/* Same slot for both states, so switching between them is a swap of
          contents rather than a layout shift. Bottom edge aligned with the
          Locate button (the bottom of the map controls cluster, which sits
          at 96px on the drawing surface — DRAW_CONTROLS_BOTTOM_PX). */}
      <div className="absolute inset-x-0 bottom-[96px] z-10 flex justify-center px-4">
        {pointCount === 0 ? (
          <span className="pointer-events-none inline-flex h-10 items-center rounded-full border border-border bg-card px-4.5 text-sm font-medium text-foreground shadow-sm">
            Tap or click the map to add your first point
          </span>
        ) : (
          <div className="pointer-events-auto flex items-center gap-2">
            <IconButton
              type="button"
              variant="outline"
              aria-label="Undo"
              className="bg-card hover:bg-card"
              onClick={onUndoPoint}
            >
              <Undo2Icon className="size-[18px]" />
            </IconButton>
            {/* Forced open over the cap: the pill turning red is the
                whole explanation otherwise, and a colour is not a
                limit. */}
            <Tooltip open={drawStopsOverCap ? true : undefined}>
              <TooltipTrigger asChild>
                <span
                  ref={pillRef}
                  onAnimationEnd={(e) =>
                    e.currentTarget.classList.remove('animate-shake')
                  }
                  className={`inline-flex h-9 items-center rounded-full border px-3.5 text-sm font-semibold ${
                    drawStopsOverCap
                      ? 'border-destructive bg-brand-red-100 text-destructive-dark'
                      : 'border-border bg-card text-foreground'
                  }`}
                >
                  {drawStopCount.toLocaleString()} selected
                </span>
              </TooltipTrigger>
              <TooltipContent side="top">Limit is 150 per list</TooltipContent>
            </Tooltip>
          </div>
        )}
      </div>
      {/* Same padding as `OutreachSheet`'s DrawerFooter (`px-6 py-4`), so
          the drawing surface's Continue/Back land at the same widths and
          positions as every other step's footer buttons. The button
          classNames themselves already mirror `OutreachFlowShell` — the
          gap was the container padding. */}
      <div className="pointer-events-auto absolute inset-x-0 bottom-0 z-10 border-t border-border bg-background px-6 py-4">
        <div className="mx-auto flex w-full max-w-[608px] flex-row-reverse items-center justify-between gap-3">
          <Button
            type="button"
            size="large"
            className="min-w-0 flex-1 lg:min-w-[240px] lg:flex-none"
            disabled={continueDisabled}
            onClick={onContinue}
          >
            Continue
          </Button>
          <Button
            type="button"
            size="large"
            variant="ghost"
            aria-label="Back"
            className="shrink-0 lg:min-w-[140px]"
            onClick={onClose}
          >
            Back
          </Button>
        </div>
      </div>
      <AlertDialog open={instructionsOpen} onOpenChange={setInstructionsOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Draw your boundary</AlertDialogTitle>
            <AlertDialogDescription className="sr-only">
              Instructions for drawing your door-knocking boundary.
            </AlertDialogDescription>
          </AlertDialogHeader>
          {/* `[&>li]:list-item` guards against a global rule that hides
              bullets on <li> elements; without it the numbers vanish and
              the list reads as an unindented paragraph. */}
          <ol className="list-decimal space-y-2 pl-5 text-base [&>li]:list-item">
            <li>
              Tap or click the map to drop corner points around the area you
              want to knock.
            </li>
            <li>Add at least 3 points to close the shape.</li>
            <li>Use Undo to remove your last point.</li>
            <li>Aim for 150 stops or fewer. Larger areas won&apos;t route.</li>
          </ol>
          <AlertDialogFooter>
            <AlertDialogAction onClick={() => setInstructionsOpen(false)}>
              Got it
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
