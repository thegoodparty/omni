'use client'

import { DoorKnockStatus, RoutePayloadStop } from '@goodparty_org/contracts'
import {
  STATUS_DOT_COLORS,
  STATUS_LABELS,
  targetMarker,
} from './statusPresentation'

// A frozen route is hard-capped at 150 stops server-side, so this list is
// already bounded — it cannot grow with the district the way the 180k-dot pack
// can. That is why the cap below is a cap and not a virtualizer: a windowing
// library would add a dependency and a second scroll container nested inside
// the sheet's own, to bound a list that the knock endpoint already bounds.
// Multi-unit buildings still fan one stop out into many doors, so the ceiling
// isn't 150 — hence a cap rather than nothing at all.
const MAX_ROSTER_DOORS = 50

const StatusDot = ({ status }: { status: DoorKnockStatus }) => (
  <span
    className="h-2 w-2 shrink-0 rounded-full"
    style={{ backgroundColor: STATUS_DOT_COLORS[status] }}
  />
)

interface TurfRosterProps {
  stops: RoutePayloadStop[]
}

// The households in a frozen route, grouped by door. This exists only on the
// locked branch, and the reason is in packDecoder.ts rather than here: the
// voter pack is coordinates and u8 category planes with no names, no address
// strings and no person ids, so an unknocked list has no roster to show at any
// price. `TurfDetailsSheet` says that in words instead of rendering this.
//
// Two omissions are deliberate. **No phone numbers** — `cellPhone`/`landline`
// ride the route payload for `PersonSheet`, which shows them one resident at a
// time behind a tap; printing them down a fifty-door list is a different act of
// disclosure wearing the same permission, and this surface has no use for them.
// **No `otherResidents`** — they are household context for a conversation at
// the door, not members of this list, so listing them here would contradict the
// People stat directly above and answer "who is in this list" with people who
// are not.
export default function TurfRoster({ stops }: TurfRosterProps) {
  // An address IS a door — `countDoors` counts exactly these, so the roster's
  // length and the Doors stat above it cannot disagree. A stop is the
  // coordinate the router visits and can hold many of them.
  const doors = stops.flatMap((stop) => stop.addresses)
  const shown = doors.slice(0, MAX_ROSTER_DOORS)
  // ADR 0007 / 0008. Flagged residents are listed and NOT counted, which is
  // the printed sheet's rule ("the header is the evening's work, the rows are
  // the index"). Rows without a word for it read as the People stat being
  // broken, so the roster says which way round it is.
  const hasFlagged = doors.some((door) =>
    door.targets.some((target) => targetMarker(target) !== null),
  )

  return (
    <div className="flex flex-col gap-2">
      {hasFlagged && (
        <p className="text-xs text-muted-foreground">
          Residents marked do-not-knock or &ldquo;not a voter&rdquo; are listed
          here so you know the door was considered, but they are left out of the
          counts above — nobody will knock them.
        </p>
      )}
      <ul className="flex flex-col gap-2">
        {/* No stop numbers. `seq` still orders the route on the map and on
            paper, but the Aug 14 walkthrough asked numerals out of the list
            view: nothing holds a canvasser to walking these top to bottom, so a
            numeral here would imply an order the product doesn't enforce. */}
        {shown.map((door) => (
          <li
            key={door.addressKey}
            className="rounded-lg border border-border p-3"
          >
            <p className="truncate text-sm font-medium">{door.address}</p>
            <div className="mt-1.5 flex flex-col gap-1">
              {door.targets.map((target) => {
                // The marker REPLACES the status, per statusPresentation's one
                // rule for every surface that lists people side by side — a
                // resident reading "Do not knock" here and "Support unknown"
                // in the walk view is two answers to one question.
                const marker = targetMarker(target)
                return (
                  <div
                    key={target.stopTargetId}
                    className="flex items-center justify-between gap-3 text-sm"
                  >
                    <span className="truncate">
                      {target.name ?? 'Name unavailable'}
                    </span>
                    {marker ? (
                      <span className="shrink-0 text-xs font-medium text-warning">
                        {marker}
                      </span>
                    ) : (
                      <span className="flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground">
                        <StatusDot status={target.knockStatus} />
                        {STATUS_LABELS[target.knockStatus]}
                      </span>
                    )}
                  </div>
                )
              })}
            </div>
          </li>
        ))}
      </ul>
      {doors.length > shown.length && (
        <p className="text-xs text-muted-foreground">
          {`Showing the first ${shown.length} of ${doors.length.toLocaleString()} doors. The printed walk list carries every one of them.`}
        </p>
      )}
    </div>
  )
}
