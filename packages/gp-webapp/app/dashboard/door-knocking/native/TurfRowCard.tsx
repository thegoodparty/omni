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
// anything below the counts line (a progress bar, a confirm dialog) is the
// caller's `children`.
//
// `flex-row` is explicit and load-bearing: `Card` ships `flex flex-col`, and
// tailwind-merge does not treat `flex` as overriding `flex-col`, so a bare
// `flex` here stacks the row into a centered column. That is exactly what it
// did before this was extracted.
type Props = {
  turf: Pick<DoorKnockingTurf, 'name' | 'color' | 'doorCount' | 'peopleCount'>
  // Dimmed for a turf that is done or archived, the same treatment the
  // rail's rings get: shelved is a state, not a deletion.
  muted?: boolean
  actions?: ReactNode
  children?: ReactNode
}

export const TurfRowCard = ({
  turf,
  muted = false,
  actions,
  children,
}: Props) => (
  <Card className="gap-2 rounded-lg p-3">
    <div className="flex flex-row items-center gap-3">
      <span
        aria-hidden="true"
        className={`h-3 w-3 shrink-0 rounded-full ${muted ? 'opacity-40' : ''}`}
        style={{ backgroundColor: turf.color }}
      />
      <span
        className={`min-w-0 flex-1 truncate text-sm font-medium ${
          muted ? 'text-muted-foreground' : 'text-foreground'
        }`}
      >
        {turf.name}
      </span>
      {actions}
    </div>
    <div className="flex flex-row items-center justify-between text-xs text-muted-foreground">
      <span>
        {turf.peopleCount.toLocaleString()} people (
        {turf.doorCount.toLocaleString()} doors)
      </span>
    </div>
    {children}
  </Card>
)
