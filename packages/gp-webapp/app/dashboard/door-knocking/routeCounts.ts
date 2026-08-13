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

export const countPeople = (stops: DoorKnockingRoutePayload['stops']): number =>
  stops.reduce(
    (total, stop) =>
      total +
      stop.addresses.reduce(
        (perStop, address) => perStop + address.targets.length,
        0,
      ),
    0,
  )

// The three counts above are inventory — what the route contains, and what the
// printed sheet lists row for row, flagged residents included (paper carries
// their skip instruction rather than dropping them). Progress is a different
// question: ADR 0007 doors are ones nobody should knock, so counting them would
// hold a canvasser who correctly skipped every one of them below 100%. Every
// reached-of-total on any surface counts these, and only these.
export const knockableTargets = (stops: DoorKnockingRoutePayload['stops']) =>
  stops.flatMap((stop) =>
    stop.addresses.flatMap((address) =>
      address.targets.filter((target) => !target.doNotKnock),
    ),
  )
