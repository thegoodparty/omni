import type { DoorKnockingRoutePayload } from '@goodparty_org/contracts'

// A route has three different populations and they are not interchangeable:
//
//   stops     geocoded coordinates the router visits — one apartment building
//             is ONE stop no matter how many units are in it
//   doors     addresses, including the unit — what you physically knock on
//   people    targeted voters, several of whom can share one door
//
// "Doors" is the one a canvasser plans their evening around, and it used to be
// reported as stops in the app and as people on the printed sheet, so the same
// route showed two different door counts depending on where you looked. Both
// are computed here so they cannot drift again.
export const countDoors = (stops: DoorKnockingRoutePayload['stops']): number =>
  stops.reduce((total, stop) => total + stop.addresses.length, 0)

// People, and the only definition of them: ADR 0007 doors are ones nobody
// should knock, so they are not conversations anyone can have. Counting them
// would promise a canvasser an evening they can't have and hold the one who
// correctly skipped every flagged house below 100%. Every people figure and
// every reached-of-total reads this.
//
// The printed sheet still LISTS flagged residents, one row each — paper freezes
// at print time and is the surface used without the app, so it has to carry
// their skip instruction rather than quietly drop them. A sheet that lists more
// names than its header counts is the intended reading: the header is the
// evening's work, the rows are the index.
export const knockableTargets = (stops: DoorKnockingRoutePayload['stops']) =>
  stops.flatMap((stop) =>
    stop.addresses.flatMap((address) =>
      address.targets.filter((target) => !target.doNotKnock),
    ),
  )
