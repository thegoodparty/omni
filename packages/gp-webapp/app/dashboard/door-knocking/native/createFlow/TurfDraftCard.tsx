import { Card, Trash2Icon } from '@styleguide'
import type { PolygonStats } from '../filterEngine'
import type { TurfDraft } from '../turfDrafts'

interface TurfDraftCardProps {
  draft: TurfDraft
  // The pack's answer for this boundary, or null while the pack is still
  // decoding. Null prints an em dash rather than a zero — this step's own
  // rule about counts that have not arrived.
  stats: PolygonStats | null
  assigneeLabel: string | null
  // Reopen the drawing surface with this turf's boundary under the cursor.
  onEdit: () => void
  onRemove: () => void
}

// One turf of a campaign, as it stands before anything is bought. Stacked
// under the draw step's map preview, one per turf cut this session.
//
// Counts are softened to "About N" for the same reason every other pre-route
// figure on this surface is: they come from the pack, and the pack cannot
// shade every way a list narrows — the paid create runs its own exact
// evaluation and drops do-not-knock and not-a-voter residents on top. The
// number is a superset of who gets knocked, and the wording says so.
//
// No progress, no route time, no Knock button: none of those exists yet, and
// a card that reserved space for them would read as a saved list that had
// failed to load rather than as a turf that has not been bought.
//
// The title is the button, never the card — the rule `ListCard` records, and
// for the same reason: a card-wide handler needs `stopPropagation` on every
// control inside it and announces to a screen reader as a button containing
// buttons.
//
// Remove sits on the row rather than behind an overflow menu, which is a
// deliberate departure from the rule this directory records for SAVED lists.
// That rule is about a paid, routed, tombstoned-on-delete list where an
// accidental tap is unrecoverable. A draft costs nothing and has bought
// nothing; the worst an accidental tap does is ask for the boundary to be
// drawn again, and an overflow menu holding one item is a tap tax on the
// ordinary case. It is not tinted destructive at rest for the same reason.
export const TurfDraftCard = ({
  draft,
  stats,
  assigneeLabel,
  onEdit,
  onRemove,
}: TurfDraftCardProps) => (
  <Card className="shrink-0 flex-row items-center gap-3 rounded-lg p-3">
    <span
      aria-hidden="true"
      className="size-3 shrink-0 rounded-full"
      style={{ backgroundColor: draft.color }}
    />
    <div className="flex min-w-0 flex-1 flex-col gap-0.5">
      <button
        type="button"
        onClick={onEdit}
        className="truncate text-left text-sm font-medium hover:underline"
      >
        {draft.name}
      </button>
      <span className="text-xs text-muted-foreground">
        {stats === null ? (
          '—'
        ) : (
          <>
            {/* An `sr-only` noun on each figure: stops, doors and people are
                three different numbers in this feature, and a screen reader
                gets none of the layout that makes which-is-which obvious. */}
            About {stats.people.toLocaleString()}
            <span className="sr-only"> people</span>
            {' · '}
            {stats.households.toLocaleString()}
            <span className="sr-only"> doors</span>
            <span aria-hidden="true"> doors</span>
          </>
        )}
        {assigneeLabel && ` · ${assigneeLabel}`}
      </span>
    </div>
    <button
      type="button"
      aria-label={`Remove ${draft.name}`}
      className="shrink-0 rounded-md p-1.5 text-muted-foreground hover:text-destructive"
      onClick={onRemove}
    >
      <Trash2Icon className="size-4" />
    </button>
  </Card>
)
