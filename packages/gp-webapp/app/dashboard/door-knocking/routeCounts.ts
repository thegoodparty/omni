import type {
  DoorKnockingRoutePayload,
  RoutePayloadTarget,
} from '@goodparty_org/contracts'

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
// should knock, and ADR 0008 residents are ones who moved away or died, so
// neither is a conversation anyone can have. Counting them would promise a
// canvasser an evening they can't have and hold the one who correctly skipped
// every flagged house below 100%. Every people figure and every
// logged-of-total reads this.
//
// The two reasons are one predicate here on purpose. They differ in what to say
// at the door, which is the walk UI's problem; to a count they are the same
// fact — nobody to talk to.
//
// The printed sheet still LISTS flagged residents, one row each — paper freezes
// at print time and is the surface used without the app, so it has to carry
// their skip instruction rather than quietly drop them. A sheet that lists more
// names than its header counts is the intended reading: the header is the
// evening's work, the rows are the index.
export const isKnockable = (target: RoutePayloadTarget): boolean =>
  !target.doNotKnock && !target.notAVoterReason

export const knockableTargets = (stops: DoorKnockingRoutePayload['stops']) =>
  stops.flatMap((stop) =>
    stop.addresses.flatMap((address) => address.targets.filter(isKnockable)),
  )
