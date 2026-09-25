import type { ReactNode } from 'react'
import type { DoorKnockingTurf } from '@goodparty_org/contracts'
import { Card } from '@styleguide'

// One turf, as a row. Extracted because three surfaces draw the same thing
// and had started to disagree about it: the outreach drawer's campaign
// sibling list, the create flow's success screen, and whatever reads a
// campaign next. A turf row that looks different depending on which sheet
// it is in is the kind of drift nobody files a bug for.
//
// Presentational only. The actions differ everywhere — Mark done and
// Continue in the drawer, Start knocking on the success screen — so they
// come in as a slot rather than as a union of every caller's buttons, and
// anything below the row (a progress bar, a confirm dialog) is the caller's
// `children`.
//
// **Its row is `TurfCard`'s row and has to stay that way.** They are two
// components because what they carry differs — this one has no selection,
// no rename, no open half, and takes arbitrary actions — but they draw the
// same object, and the create flow puts one on screen two steps after the
// other. Change the arrangement here and change it there.
//
// `flex-row` is explicit and load-bearing: `Card` ships `flex flex-col`, and
// tailwind-merge does not treat `flex` as overriding `flex-col`, so a bare
// `flex` here stacks the row into a centered column. That is exactly what it
// did before this was extracted.
type Props = {
  turf: Pick<DoorKnockingTurf, 'name' | 'color' | 'stopCount' | 'peopleCount'>
  // Dimmed for a turf that is done or archived, the same treatment the
  // rail's rings get: shelved is a state, not a deletion.
  muted?: boolean
  // Leaves the figures off the name row, for a caller that has a second
  // line of its own to put them on. The drawer does: its rows carry a
  // progress bar, and two lines of numbers under one name is one too many.
  hideCounts?: boolean
  actions?: ReactNode
  children?: ReactNode
}

// What a turf is worth, in the one wording every surface that lists turfs
// uses. Stops first because it is the router's own unit and the one the 150
// cap is stated in; people because it is who is behind them. Doors sit
// between the two and are deliberately not here — a card carrying all three
// asks a candidate comparing two turfs to hold three ratios in their head,
// which is the rule `draftCounts.tsx` already records.
export const turfCountsLabel = (
  turf: Pick<DoorKnockingTurf, 'stopCount' | 'peopleCount'>,
) =>
  `${turf.stopCount.toLocaleString()} ${
    turf.stopCount === 1 ? 'stop' : 'stops'
  }, ${turf.peopleCount.toLocaleString()} ${
    turf.peopleCount === 1 ? 'person' : 'people'
  }`

export const TurfRowCard = ({
  turf,
  muted = false,
  hideCounts = false,
  actions,
  children,
}: Props) => (
  <Card className="gap-2 rounded-lg p-3">
    {/* ONE line, and the arrangement is `TurfCard`'s: the dot, what the turf
        is called, what it is worth pushed right, the action last. The counts
        used to sit on a second line under the name, which made a row twice
        the height of the card the same turf had on the draw step two screens
        earlier — the same object, drawn two ways, one after the other.
        Anything below this line is a caller's `children`. */}
    <div className="flex flex-row items-center gap-3">
      <span
        aria-hidden="true"
        className={`my-auto size-3 shrink-0 rounded-full ${muted ? 'opacity-40' : ''}`}
        style={{ backgroundColor: turf.color }}
      />
      <span className="flex min-w-0 flex-1 items-baseline gap-2">
        <span
          className={`min-w-0 flex-1 truncate text-sm font-medium ${
            muted ? 'text-muted-foreground' : 'text-foreground'
          }`}
        >
          {turf.name}
        </span>
        {/* The group shrinks by truncating the NAME, never the number —
            which is what puts every row's figures in the same column. */}
        {!hideCounts && (
          <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
            {turfCountsLabel(turf)}
          </span>
        )}
      </span>
      {actions}
    </div>
    {children}
  </Card>
)
