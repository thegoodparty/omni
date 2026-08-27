import { DOOR_KNOCK_STATUSES, DoorKnockStatus } from '@goodparty_org/contracts'
import { FilterPill, FilterPillGroup } from '@styleguide'
import { STATUS_DOT_COLORS, STATUS_LABELS } from './statusPresentation'

interface TurfLegendProps {
  // Person-level counts over the selected scope. Not narrowed by the pressed
  // chips — see the rail's note in AGENTS.md.
  statusCounts: Partial<Record<DoorKnockStatus, number>>
  statusFilter: Set<DoorKnockStatus>
  onToggleStatus: (status: DoorKnockStatus) => void
  // The scope's tri-state, forwarded rather than re-derived: `ready` prints the
  // count, `pending` a skeleton, and a settled nothing an em dash.
  ready: boolean
  pending: boolean
}

/**
 * The seven canvass-status chips, as a wrapping flow that is whole on screen.
 *
 * This was one horizontally scrolling row until 2026-08-26, when the product
 * owner asked for the whole legend to be visible at once. The argument for
 * scrolling is kept in AGENTS.md rather than deleted, because it was a real
 * one: wrapped chips are taller, and the rail pays for that in list room.
 *
 * What makes wrapping affordable now is that the page is finally the height of
 * the window (`NativeDoorKnockingPage`'s `min-h-0` wrapper), so the rail is a
 * bounded card whose list region absorbs the extra rows by scrolling — the
 * thing the original objection said would be pushed off screen. The chips are
 * also drawn tighter than the DS default, which is what gets two of them onto
 * a row in a 384px rail instead of one.
 */
export default function TurfLegend({
  statusCounts,
  statusFilter,
  onToggleStatus,
  ready,
  pending,
}: TurfLegendProps) {
  return (
    // Padded and negatively margined so a chip's focus ring isn't clipped at
    // the edge of the rail's own padding.
    <div className="-mx-1 px-1">
      <FilterPillGroup
        type="multiple"
        value={[...statusFilter]}
        // Radix reports the whole next selection; the chip that moved is the
        // one status the two sets disagree on, which is what the orchestrator
        // wants — it decides what pressing one means, not this row.
        onValueChange={(next) => {
          const changed = DOOR_KNOCK_STATUSES.find(
            (status) => next.includes(status) !== statusFilter.has(status),
          )
          if (changed) onToggleStatus(changed)
        }}
        // `flex-wrap` is the DS default; naming it here is the point of the
        // component, so it is stated rather than inherited. `gap-1.5` over the
        // DS `gap-2` for the same reason the padding below is tighter.
        className="flex-wrap gap-1.5"
        aria-label="Filter the map by canvass status"
      >
        {DOOR_KNOCK_STATUSES.map((status) => (
          <FilterPill
            key={status}
            value={status}
            // A chip narrows WITHIN the scope, so with no scope to narrow it
            // could only flip its own pressed state and change nothing.
            disabled={!ready}
            // `max-w-full` is the narrow-viewport guard: a chip is never
            // allowed to be wider than the rail, so the flow can always place
            // it. `min-w-0` lets the label inside it shrink to make that true.
            // At every width down to 320px the labels still fit whole — this
            // is the floor that keeps a very narrow phone from overflowing
            // sideways, not a truncation the layout expects to use.
            className="max-w-full min-w-0 gap-1.5 px-2.5 py-1 text-xs"
          >
            {/* `shrink-0` on both the dot and the count: the pill may now
                shrink (see `min-w-0` above), and the two things a squeezed
                chip must never give up are the colour that ties it to the dots
                on the map and the number it is reporting. */}
            <span
              aria-hidden="true"
              className="size-2 shrink-0 rounded-full"
              style={{ backgroundColor: STATUS_DOT_COLORS[status] }}
            />
            {STATUS_LABELS[status]}
            {/* Seven zeroes under a list's name is the same confident wrong
                answer as one wrong total, so an unresolved scope prints no
                number: a skeleton while it can still arrive, an em dash once
                it can't. */}
            {ready ? (
              <span className="shrink-0 font-semibold tabular-nums">
                {(statusCounts[status] ?? 0).toLocaleString()}
              </span>
            ) : pending ? (
              <span
                aria-hidden="true"
                className="h-3 w-5 shrink-0 animate-pulse rounded bg-muted"
              />
            ) : (
              <span className="shrink-0 font-semibold">&mdash;</span>
            )}
          </FilterPill>
        ))}
      </FilterPillGroup>
    </div>
  )
}
