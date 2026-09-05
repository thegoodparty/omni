import { useState } from 'react'
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

  return (
    <div className="pointer-events-none absolute inset-0 z-20">
      {pointCount === 0 && (
        <div className="absolute inset-0 flex items-center justify-center p-4">
          <span className="rounded-2xl border border-border bg-card px-4 py-3 text-sm font-medium shadow-lg">
            Tap the map to add boundary points
          </span>
        </div>
      )}
      {pointCount > 0 && (
        // Bottom-right, clear of the footer — the canvas's own 88px offset.
        <div className="absolute right-3 bottom-[88px] z-10 flex items-center gap-2">
          {/* Forced open over the cap: the pill turning red is the whole
              explanation otherwise, and a colour is not a limit. */}
          <Tooltip open={overCap ? true : undefined}>
            <TooltipTrigger asChild>
              <span
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
            type="button"
            variant="outline"
            aria-label="Undo"
            className="pointer-events-auto bg-card"
            onClick={onUndoPoint}
          >
            <Undo2Icon className="size-[18px]" />
          </IconButton>
        </div>
      )}
      <div className="pointer-events-auto absolute inset-x-0 bottom-0 z-10 border-t border-border bg-background p-4">
        <div className="mx-auto w-full max-w-[608px]">
          {/* Row-reverse mirroring `OutreachFlowShell`'s footer: Continue on
              the right, Back on the left. Back reuses `onClose`, which the
              caller already wires to `leaveFullScreen` — so the shape's own
              "Discard this turf?" still guards a drawn boundary. */}
          <div className="flex flex-row-reverse items-center justify-between gap-3">
            <Button disabled={continueDisabled} onClick={onContinue}>
              Continue
            </Button>
            <Button variant="ghost" aria-label="Back" onClick={onClose}>
              Back
            </Button>
          </div>
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
          <ol className="ml-5 list-decimal space-y-2 text-sm">
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
