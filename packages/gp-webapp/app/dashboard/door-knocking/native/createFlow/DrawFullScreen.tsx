import {
  Button,
  IconButton,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  Undo2Icon,
  XMarkIcon,
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

// The canvas's `dkDrawFullScreen`: the map, uncovered, with four pieces of
// chrome over it. Everything is `pointer-events-none` except the controls, so
// every tap that is not on one of them reaches the map and places a vertex.
//
// The stats, the walk estimate, the cap warnings and the addresses panel are
// NOT here — the canvas puts its counts on the step behind this one, and so do
// we. This surface is the map and the way forward from it.
export const DrawFullScreen = ({
  pointCount,
  onUndoPoint,
  stops,
  overCap,
  continueDisabled,
  onContinue,
  onClose,
}: DrawFullScreenProps) => (
  <div className="pointer-events-none absolute inset-0 z-20">
    <div className="absolute inset-x-4 top-4 z-10 flex items-center justify-end">
      <IconButton
        type="button"
        variant="outline"
        aria-label="Close"
        className="pointer-events-auto bg-card"
        onClick={onClose}
      >
        <XMarkIcon className="size-[18px]" />
      </IconButton>
    </div>
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
        <Button
          className="w-full"
          disabled={continueDisabled}
          onClick={onContinue}
        >
          Continue
        </Button>
      </div>
    </div>
  </div>
)
