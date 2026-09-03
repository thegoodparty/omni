import type { ReactNode } from 'react'
import {
  ArrowLeftIcon,
  Button,
  IconButton,
  PencilIcon,
  Stepper,
  XMarkIcon,
} from '@styleguide'
import { Intro } from 'app/dashboard/outreach/v2/social/Intro'

interface DrawStepProps {
  currentStep: number
  totalSteps: number
  onBack: () => void
  onClose: () => void
  // The canvas's own two figures, in the canvas's own order: the audience the
  // filters cut, and how much of it the boundary currently encloses.
  matchingHouseholds: number
  selectedHouseholds: number
  onOpenFullScreen: () => void
  // Everything this step reports about the shape beyond the canvas's count
  // line: the walk-time estimate, the cap warnings, the disclosure sentence
  // and the addresses panel. Rendered below the preview, in the scrolling half
  // of the step.
  children: ReactNode
}

// The draw step, as the canvas builds it: the counts, a map preview, and one
// button that opens the map full screen to actually cut the shape. Two things
// make it the one step that is NOT rendered through OutreachFlowShell.
//
// The canvas's preview is a picture of its own SVG map. Ours cannot be — the
// map is a single MapLibre instance owned by the orchestrator, which outlives
// this flow and cannot be moved into a Vaul portal without being destroyed,
// and a second canvas would pull maplibre and deck.gl into the chunk this flow
// is deliberately outside of (and bill a second set of tiles). So the preview
// is a WINDOW: the panel is opaque everywhere except the box, and the live map
// underneath shows through it. The gutters either side of the 608px column are
// drawn as their own opaque blocks, which is the only way to leave a hole in
// an otherwise solid surface.
//
// The window is shielded, for the same reason the confirm step's band was: the
// drawing session is live on this step, so a tap reaching the map would splice
// a vertex into the very shape the candidate came here to review, with no Undo
// control on this screen to take it back. Drawing happens in DrawFullScreen.
//
// The chrome repeats OutreachSheet's anatomy exactly — 64px mobile top padding
// with the back button pinned into it, a reserved 40px row on desktop, the bar
// stepper, the corner X at the column's right edge, and the 608px column in
// every band — so the step reads as the same sheet the other four steps are.
export const DrawStep = ({
  currentStep,
  totalSteps,
  onBack,
  onClose,
  matchingHouseholds,
  selectedHouseholds,
  onOpenFullScreen,
  children,
}: DrawStepProps) => (
  <div className="absolute inset-0 z-20 flex flex-col">
    <div className="shrink-0 border-b border-border bg-background px-6 pt-16 pb-5 lg:pt-6">
      <div className="mx-auto w-full max-w-[608px]">
        <div className="flex h-0 items-center lg:mb-4 lg:h-10">
          <IconButton
            type="button"
            variant="outline"
            aria-label="Back"
            onClick={onBack}
            className="absolute top-4 left-4 z-30 border-border text-foreground lg:static"
          >
            <ArrowLeftIcon className="size-4" />
          </IconButton>
        </div>
        <Stepper
          variant="bar"
          currentStep={currentStep}
          totalSteps={totalSteps}
          labelClassName="text-xs"
        />
      </div>
    </div>
    {/* Ghost, like the X every other step of this flow renders through
        `OutreachSheet`. IconButton's default is the filled primary, which drew
        a blue disc in the one corner the other four steps leave bare. */}
    <IconButton
      type="button"
      variant="ghost"
      aria-label="Close"
      onClick={onClose}
      className="absolute top-4 right-4 z-30 size-10 rounded-full lg:right-[max(1.5rem,calc((100%-608px)/2))]"
    >
      <XMarkIcon className="size-4" />
    </IconButton>
    {/* The canvas's 10px gap above the window is padding on this opaque block
        rather than a margin on the window's own, which left it outside every
        painted element — a 10px stripe of live map running the full width of
        an otherwise solid sheet. */}
    <div className="shrink-0 bg-background px-6 pt-5 pb-2.5">
      <div className="mx-auto flex w-full max-w-[608px] flex-col gap-6">
        <Intro
          channel="nativeDoorKnocking"
          title="Draw your door knocking boundaries"
          body="Outline map areas to build targeted door lists."
        />
        <p className="text-sm">
          <span className="font-semibold tabular-nums">
            {matchingHouseholds.toLocaleString()}
          </span>{' '}
          <span className="text-muted-foreground">matching households</span> ·{' '}
          <span className="font-semibold tabular-nums">
            {selectedHouseholds.toLocaleString()}
          </span>{' '}
          <span className="text-muted-foreground">selected households</span>
        </p>
      </div>
    </div>
    {/* The window. Its height is the canvas's — 200 on a phone, 260 above it. */}
    <div className="relative h-[200px] shrink-0 lg:h-[260px]">
      <div aria-hidden="true" className="absolute inset-0 flex">
        <div className="min-w-6 flex-1 bg-background" />
        <div className="w-full max-w-[608px] shrink" />
        <div className="min-w-6 flex-1 bg-background" />
      </div>
      <div className="absolute inset-0 px-6">
        <div className="relative mx-auto h-full w-full max-w-[608px] overflow-hidden rounded-xl border border-border">
          {/* The shield. Nothing here is a control; it exists so the live
              drawing session underneath cannot be reached from a step whose
              job is to show the shape rather than to change it. */}
          <div aria-hidden="true" className="absolute inset-0" />
          <div className="absolute inset-0 flex items-center justify-center">
            <Button onClick={onOpenFullScreen}>
              <PencilIcon className="size-4" />
              Draw boundaries
            </Button>
          </div>
        </div>
      </div>
    </div>
    <div className="min-h-0 flex-1 overflow-y-auto bg-background px-6 pt-4 pb-5">
      <div className="mx-auto flex w-full max-w-[608px] flex-col gap-3">
        {children}
      </div>
    </div>
  </div>
)
