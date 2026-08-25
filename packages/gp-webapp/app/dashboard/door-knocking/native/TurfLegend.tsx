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
 * The seven canvass-status chips, on one horizontally scrolling row.
 *
 * Wrapping was what the rail did before, and in a 384px column it stacked into
 * three rows of chips that pushed the saved lists off the first screen of the
 * feature. One row keeps the legend a strip under the count line at any width;
 * the row scrolls rather than truncating, because a chip a candidate cannot
 * reach is a filter they cannot clear.
 */
export default function TurfLegend({
  statusCounts,
  statusFilter,
  onToggleStatus,
  ready,
  pending,
}: TurfLegendProps) {
  return (
    // The scroll container is padded and negatively margined so a chip's focus
    // ring isn't clipped by its own overflow.
    <div className="-mx-1 overflow-x-auto px-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
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
        className="w-max flex-nowrap gap-1.5"
        aria-label="Filter the map by canvass status"
      >
        {DOOR_KNOCK_STATUSES.map((status) => (
          <FilterPill
            key={status}
            value={status}
            // A chip narrows WITHIN the scope, so with no scope to narrow it
            // could only flip its own pressed state and change nothing.
            disabled={!ready}
            className="shrink-0 gap-1.5 px-2.5 py-1 text-xs"
          >
            <span
              aria-hidden="true"
              className="size-2 rounded-full"
              style={{ backgroundColor: STATUS_DOT_COLORS[status] }}
            />
            {STATUS_LABELS[status]}
            {/* Seven zeroes under a list's name is the same confident wrong
                answer as one wrong total, so an unresolved scope prints no
                number: a skeleton while it can still arrive, an em dash once
                it can't. */}
            {ready ? (
              <span className="font-semibold tabular-nums">
                {(statusCounts[status] ?? 0).toLocaleString()}
              </span>
            ) : pending ? (
              <span
                aria-hidden="true"
                className="h-3 w-5 animate-pulse rounded bg-muted"
              />
            ) : (
              <span className="font-semibold">&mdash;</span>
            )}
          </FilterPill>
        ))}
      </FilterPillGroup>
    </div>
  )
}
