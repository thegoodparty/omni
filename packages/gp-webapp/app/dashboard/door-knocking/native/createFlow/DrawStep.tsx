import type { ReactNode } from 'react'
import { PencilIcon } from '@styleguide'
import { geoapifyStaticUrl } from './geoapifyStaticUrl'

interface DrawStepProps {
  // The pack's bounding box, framed by the Geoapify static preview. Null
  // (or omitted) while the pack is still decoding; the image is omitted
  // in that window rather than rendered against no rect.
  districtBounds?: [[number, number], [number, number]] | null
  // The canvas's own two figures, in the canvas's own order: the audience the
  // filters cut, and how much of it the boundary currently encloses.
  matchingHouseholds: number
  selectedHouseholds: number
  onOpenFullScreen: () => void
  // Everything this step reports about the shape beyond the count line: the
  // cap warnings, the addresses panel. Rendered below the preview, in the
  // scrolling half of the step.
  children: ReactNode
}

// The draw step body inside OutreachFlowShell. The shell provides header
// (with the "Draw your door knocking boundaries" Intro) and footer; this
// component provides the counts, the preview card, and the addresses
// panel.
//
// The preview is one big clickable card that opens the full-screen drawing
// surface. Static Geoapify PNG framed to the pack's bounding box, with a
// pill in the center as a visual affordance. The card itself is the
// button; the pill is decorative (aria-hidden) so screen readers announce
// one control, not two.
export const DrawStep = ({
  districtBounds,
  matchingHouseholds,
  selectedHouseholds,
  onOpenFullScreen,
  children,
}: DrawStepProps) => (
  <div className="flex flex-col gap-6">
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
    <button
      type="button"
      onClick={onOpenFullScreen}
      aria-label="Draw boundaries"
      className="group relative block h-[200px] w-full overflow-hidden rounded-xl border border-border bg-muted transition-colors hover:border-primary lg:h-[260px]"
    >
      {districtBounds && (
        <img
          src={geoapifyStaticUrl({
            bounds: districtBounds,
            width: 608,
            height: 260,
          })}
          alt=""
          className="h-full w-full object-cover"
        />
      )}
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 flex items-center justify-center"
      >
        {/* Visual mimic of the styleguide Button primary variant. Not a
            real <Button> because nesting a button inside the wrapping
            <button> is invalid HTML; the card is the actual click
            target. */}
        <span className="inline-flex items-center gap-2 rounded-full border border-primary bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors group-hover:bg-primary/90">
          <PencilIcon className="size-4" />
          Draw boundaries
        </span>
      </span>
    </button>
    {children}
  </div>
)
