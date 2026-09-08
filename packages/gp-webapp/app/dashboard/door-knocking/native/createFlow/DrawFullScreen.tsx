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
} from '@styleguide'

interface DrawFullScreenProps {
  // Boundary points placed so far. The canvas only emits a ring from three, so
  // this is the only thing that knows there is a one- or two-point shape.
  pointCount: number
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
// The Undo button AND the count pill both live in VoterMapCanvas's cluster
// (the four map controls share one flex parent so the whole group keeps a
// consistent gap). This component only draws the pre-first-point hint,
// the footer with Back/Continue, and the instructions AlertDialog.
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
}: DrawFullScreenProps) => {
  const [instructionsOpen, setInstructionsOpen] = useState(true)

  return (
    <div className="pointer-events-none absolute inset-0 z-20">
      {/* Pre-first-point hint: sits above the map's control cluster (at
          bottom 96) so it doesn't compete with the Undo + pill row for
          horizontal space at narrow widths. Disappears the moment a
          point lands, because the map itself becomes the affordance. */}
      {pointCount === 0 && (
        <div className="absolute inset-x-0 bottom-[136px] z-10 flex h-10 justify-center px-4">
          <span className="pointer-events-none inline-flex items-center rounded-full border border-border bg-card px-4.5 text-sm font-medium text-foreground shadow-sm">
            Tap or click the map to add your first point
          </span>
        </div>
      )}
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
