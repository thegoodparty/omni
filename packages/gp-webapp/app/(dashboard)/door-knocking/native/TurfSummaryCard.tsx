import type { ReactNode } from 'react'
import type { DoorKnockingTurf } from '@goodparty_org/contracts'
import { Card, Progress } from '@styleguide'

// One turf as a RECORD: what it is, how far through it is, and what can be
// done about it. Two surfaces draw this and they must not drift — the create
// flow's success screen and the campaign details drawer's sibling list. A
// candidate meets the second within a tap of the first, so a turf that
// changes shape between them reads as a different object.
//
// **Not the same component as `TurfCard`, deliberately.** That one is a
// FORM: rename in place, colour swatches, an assignee menu, selection, an
// error caption, and "Drawing" where a count would be. Folding both into one
// would mean a variant prop gating most of the props. What the two do share
// is the row arrangement — dot, name, what the turf is worth — and that
// contract is recorded in the feature's AGENTS.md rather than enforced by a
// shared component.
//
// Presentational only, which is what lets the success screen render it with
// no queries behind it: the details drawer owns the assignee menu, the
// lifecycle mutations and the confirm dialog, and passes them in.
type Props = {
  turf: Pick<
    DoorKnockingTurf,
    'name' | 'color' | 'stopCount' | 'peopleCount' | 'loggedCount'
  >
  // Dimmed for a turf that is done or archived, the same treatment the map's
  // rings get: shelved is a state, not a deletion.
  muted?: boolean
  // Top right of the name row: the assignee menu while a turf is live, the
  // status word once it is not.
  //
  // **Required, and `null` is the way to say "nothing".** It was optional,
  // and the success screen simply left it off — so the one surface meant to
  // match the drawer shipped without the control the drawer has. A slot a
  // caller can forget is not a shared component, it is a shared stylesheet;
  // making it required moves that omission from a screenshot to a
  // typecheck. Same reason `footer` is required below.
  trailing: ReactNode
  // The washed half under the full-bleed rule. `null` drops it entirely
  // rather than rendering an empty bar: a turf with nothing left to do
  // keeps its figures and loses the footer, instead of offering a dead
  // control.
  footer: ReactNode
}

// What a turf is worth, in the one wording every surface that lists turfs
// uses. Stops first because it is the router's own unit and the one the 150
// cap is stated in; people because it is who is behind them. Doors sit
// between the two and are deliberately not here — a card carrying all three
// asks a candidate comparing two turfs to hold three ratios in their head,
// which is the rule `draftCounts.tsx` already records.
export const turfCountsLabel = (
  turf: Pick<DoorKnockingTurf, 'stopCount' | 'peopleCount'>,
) => {
  const people = `${turf.peopleCount.toLocaleString()} ${
    turf.peopleCount === 1 ? 'person' : 'people'
  }`
  // `stopCount` arrived after these surfaces did, and a preview deploy talks
  // to the dev API, which is a release behind the branch that adds it — so
  // it is genuinely absent at runtime for as long as that skew lasts, even
  // though the contract types it as required. People alone is the honest
  // degradation: `doorCount` is a DIFFERENT number (a block of flats is one
  // stop and many doors), so printing it under the word "stops" would be a
  // plausible-looking lie rather than a missing figure.
  if (typeof turf.stopCount !== 'number') return people
  return `${turf.stopCount.toLocaleString()} ${
    turf.stopCount === 1 ? 'stop' : 'stops'
  }, ${people}`
}

// Of PEOPLE logged, which is the population the counts line ends with. The
// two have to name the same denominator or the percentage reads as a share
// of stops.
export const turfPercentLabel = (
  numerator: number,
  denominator: number,
): string => {
  if (denominator === 0) return '0%'
  return `${Math.round((numerator / denominator) * 100)}%`
}

export const TurfSummaryCard = ({
  turf,
  muted = false,
  trailing,
  footer,
}: Props) => {
  const progress =
    turf.peopleCount > 0 ? (turf.loggedCount / turf.peopleCount) * 100 : 0

  return (
    // Two halves with a full-bleed rule between them, which is this
    // directory's standard for an expand-in-place card. `overflow-clip` and
    // not `overflow-hidden`: the CSSOM spec treats hidden as a scrollable
    // box, which makes an ancestor a `scrollIntoView` target and has already
    // cost this feature twice.
    <Card className="gap-0 overflow-clip rounded-lg p-0">
      <div className="flex flex-col gap-2 px-3 py-3">
        <div className="flex flex-row items-center gap-3">
          {/* The turf's colour is the DOT and nothing else. Drawing the bar,
              the wash and the CTA in it too was tried and reverted: a list
              became a list of differently-coloured buttons, and two of the
              palette's seven hues cannot carry white text. */}
          <span
            aria-hidden="true"
            className={`my-auto size-3 shrink-0 rounded-full ${
              muted ? 'opacity-40' : ''
            }`}
            style={{ backgroundColor: turf.color }}
          />
          <span
            className={`min-w-0 flex-1 truncate text-sm font-medium ${
              muted ? 'text-muted-foreground' : 'text-foreground'
            }`}
          >
            {turf.name}
          </span>
          {trailing}
        </div>
        <Progress value={progress} />
        {/* What the turf is worth on the left, how much of it is done on the
            right. */}
        <div className="flex flex-row items-center justify-between gap-3 text-xs text-muted-foreground">
          <span className="tabular-nums">{turfCountsLabel(turf)}</span>
          <span className="shrink-0 tabular-nums">
            {turfPercentLabel(turf.loggedCount, turf.peopleCount)}
          </span>
        </div>
      </div>
      {footer && (
        <div className="flex flex-row items-center justify-between gap-3 border-t bg-primary/5 px-3 py-2.5">
          {footer}
        </div>
      )}
    </Card>
  )
}
