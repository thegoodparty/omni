import { geoapifyStaticUrl } from './geoapifyStaticUrl'
import { DraftCounts } from './draftCounts'
import { TurfCard } from './TurfCard'
import type { PolygonStats } from '../filterEngine'
import { isDrawnTurf, type TurfDraft } from '../turfDrafts'
import type { TeamOption } from '../useTeamOptions'

interface DrawStepProps {
  // The pack's bounding box, framed by the Geoapify static preview. Null
  // (or omitted) while the pack is still decoding; the image is omitted
  // in that window rather than rendered against no rect.
  districtBounds?: [[number, number], [number, number]] | null
  // The turfs cut so far, newest last, one card each.
  drafts: TurfDraft[]
  draftStats: Map<string, PolygonStats>
  // The roster, so a card can print WHO walks the turf beside its count.
  // Only the name: setting the canvasser belongs to the drawing surface.
  team: TeamOption[]
  // Takes the pressed rectangle, which is what the map animates out of.
  onOpenFullScreen: (origin: DOMRect) => void
  onEditDraft: (clientId: string, origin: DOMRect) => void
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
  team,
  onOpenFullScreen,
  onEditDraft,
  onRemoveDraft,
}: DrawStepProps) => {
  // Singular after the first: the press cuts ONE turf, and "more" invited a
  // candidate to expect the next screen to take several at once.
  const label = drafts.length > 0 ? 'Draw another turf' : 'Draw turfs'
  return (
    <div className="flex flex-col gap-6">
      <button
        type="button"
        onClick={(event) =>
          onOpenFullScreen(event.currentTarget.getBoundingClientRect())
        }
        aria-label={label}
        className="group relative block h-[140px] w-full shrink-0 overflow-hidden rounded-xl border border-border bg-muted transition-colors hover:border-primary lg:h-[170px]"
      >
        {districtBounds && (
          <img
            src={geoapifyStaticUrl({
              bounds: districtBounds,
              // Requested at the height it is DRAWN at. The rect is what
              // Geoapify frames the district's bbox into, so asking for a
              // taller one and letting `object-cover` crop would cut the
              // top and bottom off the district this is a picture of.
              width: 608,
              height: 170,
            })}
            alt=""
            className="h-full w-full object-cover"
          />
        )}
        {/* The map is a backdrop here, not a thing to read — it carries no
            ring, no dots and no label the candidate needs at this size, so
            it is washed back to let the one control on it be the subject.

            Washed LIGHT, not dark. A dark scrim was the first attempt and
            it was the wrong direction twice: it turned the basemap's greens
            and blues into one muddy blue-grey, and it put a saturated blue
            button on a dark blue background, which is the pairing with the
            least contrast of any available. White takes the map toward the
            page it sits on and leaves the button the only saturated thing
            in the frame. */}
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 bg-background/65"
        />
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 flex items-center justify-center"
        >
          {/* Visual mimic of the styleguide Button primary variant at
              `size="large"` (h-12 px-6 text-base). Not a real <Button>
              because nesting a button inside the wrapping <button> is
              invalid HTML; the card is the actual click target.
              No icon: it is the only control on the card and the words say
              what it does, so the pencil was decoration inside a decoration. */}
          <span className="inline-flex h-12 items-center rounded-full border border-primary bg-primary px-6 py-3 text-base font-medium tracking-wide text-primary-foreground transition-colors group-hover:bg-primary/90">
            {label}
          </span>
        </span>
      </button>
      {drafts.length > 0 && (
        <div className="flex flex-col gap-2">
          {/* The same card the drawing surface's panel draws, but never
              open. A turf's name, colour and canvasser are all set while
              it is being cut, on the surface cutting it, and a second
              place to set them is a second place for the two to disagree
              about what a turf is. So these cards read: what it is
              called, who walks it, what it is worth, and a menu with the
              only two things left to do. Edit is the way back to the map,
              because the boundary can only be changed there. */}
          {drafts.map((draft) => (
            <TurfCard
              key={draft.clientId}
              name={draft.name}
              color={draft.color}
              assigneeId={draft.assigneeId}
              selected={false}
              counts={
                isDrawnTurf(draft) ? (
                  <DraftCounts stats={draftStats.get(draft.clientId) ?? null} />
                ) : (
                  'Drawing'
                )
              }
              team={team}
              onEdit={(origin) => onEditDraft(draft.clientId, origin)}
              onRemove={() => onRemoveDraft(draft.clientId)}
            />
          ))}
        </div>
      )}
    </div>
  )
}
