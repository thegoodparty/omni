import { PencilIcon } from '@styleguide'
import { geoapifyStaticUrl } from './geoapifyStaticUrl'
import { TurfDraftCard } from './TurfDraftCard'
import type { PolygonStats } from '../filterEngine'
import type { TurfDraft } from '../turfDrafts'

interface DrawStepProps {
  // The pack's bounding box, framed by the Geoapify static preview. Null
  // (or omitted) while the pack is still decoding; the image is omitted
  // in that window rather than rendered against no rect.
  districtBounds?: [[number, number], [number, number]] | null
  // The turfs cut so far, newest last, one card each.
  drafts: TurfDraft[]
  draftStats: Map<string, PolygonStats>
  assigneeLabels: Map<string, string>
  onOpenFullScreen: () => void
  onEditDraft: (clientId: string) => void
  onRemoveDraft: (clientId: string) => void
}

// The draw step body inside OutreachFlowShell. The shell provides header
// (with the "Where do you want to knock?" Intro) and footer; this step is
// one big clickable card that opens the full-screen drawing surface, and
// below it the turfs cut so far. Cap warnings, the stop count and every
// other bit of feedback live on the drawing surface itself, where the shape
// can be seen — putting them here left the candidate reading warnings on a
// static preview that had no ring on it.
//
// It used to open with "N matching households · M selected households", and
// that line is deliberately gone. Both halves were about ONE boundary, which
// is the thing this step stopped being about: a campaign is cut into several
// turfs here, so a single "selected" figure would describe whichever turf
// happened to be under the cursor and read as the campaign's total. The
// per-turf figures moved onto the cards, where each is attached to the turf
// it counts.
//
// The preview card is a static Geoapify PNG framed to the pack's bounding
// box, with a pill in the center as a visual affordance. The card itself
// is the button; the pill is decorative (aria-hidden) so screen readers
// announce one control, not two.
export const DrawStep = ({
  districtBounds,
  drafts,
  draftStats,
  assigneeLabels,
  onOpenFullScreen,
  onEditDraft,
  onRemoveDraft,
}: DrawStepProps) => {
  const label = drafts.length > 0 ? 'Draw more turfs' : 'Draw turfs'
  return (
    <div className="flex flex-col gap-6">
      <button
        type="button"
        onClick={onOpenFullScreen}
        aria-label={label}
        className="group relative block h-[200px] w-full shrink-0 overflow-hidden rounded-xl border border-border bg-muted transition-colors hover:border-primary lg:h-[260px]"
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
            {label}
          </span>
        </span>
      </button>
      {drafts.length > 0 && (
        <div className="flex flex-col gap-2">
          {drafts.map((draft) => (
            <TurfDraftCard
              key={draft.clientId}
              draft={draft}
              stats={draftStats.get(draft.clientId) ?? null}
              assigneeLabel={assigneeLabels.get(draft.clientId) ?? null}
              onEdit={() => onEditDraft(draft.clientId)}
              onRemove={() => onRemoveDraft(draft.clientId)}
            />
          ))}
        </div>
      )}
    </div>
  )
}
