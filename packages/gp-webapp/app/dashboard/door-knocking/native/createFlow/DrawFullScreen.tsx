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
  toast,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  Undo2Icon,
} from '@styleguide'

interface DrawFullScreenProps {
  // Boundary points placed so far. The canvas only emits a ring from three, so
  // this is the only thing that knows there is a one- or two-point shape.
  pointCount: number
  onUndoPoint: () => void
  // Stops inside the boundary — the unit the router and its cap are
  // denominated in, and therefore the unit the pill and its tooltip report.
  stops: number
  overCap: boolean
  continueDisabled: boolean
  onContinue: () => void
  onClose: () => void
}

// The canvas's `dkDrawFullScreen`: the map, uncovered, with chrome floating
// over it. Everything is `pointer-events-none` except the controls, so every
// tap that is not on one of them reaches the map and places a vertex.
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
  onUndoPoint,
  stops,
  overCap,
  continueDisabled,
  onContinue,
  onClose,
}: DrawFullScreenProps) => {
  const [instructionsOpen, setInstructionsOpen] = useState(true)
  const undoRef = useRef<HTMLButtonElement>(null)
  // The stop-count pill shakes when a new tap pushes the shape past the 150
  // cap, or when a subsequent tap keeps it over. The tooltip already carries
  // the "Limit is 150 stops per list" message and force-opens on overCap, so
  // the shake is attention feedback — no toast, to avoid stacking a snackbar
  // on top of a tooltip that's already saying it.
  const pillRef = useRef<HTMLSpanElement>(null)
  const prevStopsRef = useRef(stops)
  useEffect(() => {
    const previous = prevStopsRef.current
    prevStopsRef.current = stops
    // Only shake on a new tap that KEPT us over — undoing while still
    // over-cap is progress in the right direction, so the pill should not
    // scold the very move that's fixing the problem.
    if (!overCap || stops <= previous) return
    const el = pillRef.current
    if (!el) return
    el.classList.remove('animate-shake')
    // Reflow: React seeing the same class on re-render will not restart the
    // CSS animation, so the class has to go away and come back with a layout
    // between the two writes.
    void el.offsetWidth
    el.classList.add('animate-shake')
  }, [stops, overCap])

  return (
    <div className="pointer-events-none absolute inset-0 z-20">
      {/* Pre-first-point hint: sits at the same vertical position as the
          Undo/count cluster to the right and the map's own zoom/locate
          cluster to the left, so the three read as one row of chrome
          instead of a modal-looking pill floating over the map.
          Disappears the moment a point lands, because the map itself
          becomes the affordance. */}
      {pointCount === 0 && (
        <div className="absolute inset-x-0 bottom-[88px] z-10 flex h-9 justify-center">
          <span className="pointer-events-none inline-flex items-center rounded-full border border-border bg-card px-3.5 text-sm font-medium text-foreground shadow-sm">
            Tap or click to add your first point
          </span>
        </div>
      )}
      {/* Bottom-right, clear of the footer — the canvas's own 88px offset.
          Always visible like the map's own zoom/locate cluster on the left,
          so a candidate reading the instructions sees where Undo will land
          and how the count will read. Undo handles the zero-point press by
          toasting + shaking rather than hiding. */}
      <div className="absolute right-3 bottom-[88px] z-10 flex items-center gap-2">
        {/* Forced open over the cap: the pill turning red is the whole
            explanation otherwise, and a colour is not a limit. */}
        <Tooltip open={overCap ? true : undefined}>
          <TooltipTrigger asChild>
            <span
              ref={pillRef}
              onAnimationEnd={(e) =>
                e.currentTarget.classList.remove('animate-shake')
              }
              className={`pointer-events-auto inline-flex h-9 items-center rounded-full border bg-card px-3.5 text-sm font-semibold ${
                overCap
                  ? 'border-destructive text-destructive'
                  : 'border-border text-foreground'
              }`}
            >
              {stops.toLocaleString()} selected
            </span>
          </TooltipTrigger>
          {/* Stops, not doors: the 150 is a cap on the stops the router
              visits, and a limit quoted in a unit it is not measured in is a
              limit nobody can act on. */}
          <TooltipContent side="top">
            Limit is 150 stops per list
          </TooltipContent>
        </Tooltip>
        <IconButton
          ref={undoRef}
          type="button"
          variant="outline"
          aria-label="Undo"
          // `hover:bg-card` overrides the outline variant's default
          // `hover:bg-tertiary-dark/5` — the 5% tint reads as the map
          // "showing through" over a light basemap. Same argument for the
          // count pill's opaque bg-card beside it.
          className="pointer-events-auto bg-card hover:bg-card"
          onAnimationEnd={() => {
            undoRef.current?.classList.remove('animate-shake')
          }}
          onClick={() => {
            if (pointCount === 0) {
              // The toast says what happened, the shake says the tap DID
              // reach the control and it deliberately did nothing. The
              // reflow read is what lets the class re-apply mid-animation
              // — React seeing the same class on re-render will not
              // restart CSS.
              toast('There is nothing to undo')
              const el = undoRef.current
              if (el) {
                el.classList.remove('animate-shake')
                void el.offsetWidth
                el.classList.add('animate-shake')
              }
              return
            }
            onUndoPoint()
          }}
        >
          <Undo2Icon className="size-[18px]" />
        </IconButton>
      </div>
      <div className="pointer-events-auto absolute inset-x-0 bottom-0 z-10 border-t border-border bg-background p-4">
        {/* Row-reverse mirroring `OutreachFlowShell`'s footer: Continue on
            the right, Back on the left. Back reuses `onClose`, which the
            caller already wires to `leaveFullScreen` — so the shape's own
            "Discard this turf?" still guards a drawn boundary. */}
        <div className="mx-auto flex w-full max-w-[608px] flex-row-reverse items-center justify-between gap-3">
          <Button
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
