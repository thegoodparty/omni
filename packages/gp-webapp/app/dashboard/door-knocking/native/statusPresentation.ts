import {
  DOOR_KNOCK_STATUSES,
  DoorKnockStatus,
  NOT_A_VOTER_LABELS,
  NotAVoterReason,
  RoutePayloadStop,
  RoutePayloadTarget,
} from '@goodparty_org/contracts'
import { isKnockable } from '../routeCounts'

// 'unknown' is not "never knocked" — it also covers answered-but-unsure
// (deriveKnockStatus), so the label matches the filter vocabulary.
export const STATUS_LABELS: Record<DoorKnockStatus, string> = {
  unknown: 'Support unknown',
  not_home: 'Not home',
  supporter: 'Supporter',
  non_supporter: 'Non-supporter',
  inaccessible: 'Inaccessible',
  refused: 'Refused',
  not_a_voter: 'Not a voter',
}

// THE status palette — the map dots (deck.gl RGBA) and every legend chip
// (CSS hex) derive from these same numbers, so they cannot drift apart.
// The vocabulary is the demo's: unknown grey, not home yellow, supporter
// green, non-supporter red, inaccessible dark grey, refused black.
// not_a_voter (ours, not in the demo legend) is warm stone.
export const STATUS_RGB: Record<DoorKnockStatus, [number, number, number]> = {
  unknown: [156, 163, 175],
  not_home: [234, 179, 8],
  supporter: [22, 163, 74],
  non_supporter: [220, 38, 38],
  inaccessible: [71, 85, 105],
  refused: [10, 10, 10],
  not_a_voter: [120, 113, 108],
}

const toHex = ([r, g, b]: [number, number, number]): string =>
  `#${[r, g, b].map((c) => c.toString(16).padStart(2, '0')).join('')}`

export const STATUS_DOT_COLORS: Record<DoorKnockStatus, string> =
  Object.fromEntries(
    Object.entries(STATUS_RGB).map(([status, rgb]) => [
      status,
      toHex(rgb as [number, number, number]),
    ]),
  ) as Record<DoorKnockStatus, string>

// Most-actionable-first rollup, mirroring the server's rollupStopStatus:
// an 'unknown' person keeps the whole stop knockable, and an empty stop
// rolls up to 'unknown' — no seed value, so no divergence from the server.
const rollupStatuses = (statuses: DoorKnockStatus[]): DoorKnockStatus =>
  statuses.length === 0
    ? 'unknown'
    : statuses.reduce((best, status) =>
        DOOR_KNOCK_STATUSES.indexOf(status) < DOOR_KNOCK_STATUSES.indexOf(best)
          ? status
          : best,
      )

// The one place a stop's color is decided, so the walk list and the map pins
// can't drift apart.
//
// ADR 0007 and 0008. Flagged residents are left out because `unknown` outranks
// every other status above: one do-not-knock or moved-away neighbor would
// otherwise hold the stop on the grey "still to knock" color however much of the
// household had been logged. A stop with nobody left to knock rolls up from an
// empty list, so it stays `unknown` — every surface pairs the color with the
// marker below, which is what tells those two cases apart.
export const rollupStopStatus = (stop: RoutePayloadStop): DoorKnockStatus =>
  rollupStatuses(
    stop.addresses.flatMap((address) =>
      address.targets.filter(isKnockable).map((target) => target.knockStatus),
    ),
  )

// ADR 0008. The one-line instruction paper carries, worded apart on purpose.
// "Moved away" is about an address, so it only has to explain why the door is
// dropped; "deceased" is about a person at a door the rest of the household
// still answers, so it has to say what not to do and not merely what happened.
// `NOT_A_VOTER_LABELS` from contracts stays the short form (the inline marker
// and the CRM feed share it); this is the version for a surface with the room.
const NOT_A_VOTER_INSTRUCTIONS: Record<NotAVoterReason, string> = {
  moved: 'Moved away — skip this resident',
  deceased: 'Deceased — skip this resident, and do not ask for them by name',
}

// ADR 0007 and 0008. What paper prints where the tick-boxes would go. Both
// paper surfaces read this one function: they freeze at print time and are the
// only surfaces used without the app, so a flagged resident has to carry the
// instruction on the page rather than be quietly dropped from it — and the two
// formats cannot afford to say it differently. Do-not-knock is checked first
// because it is about the door, so it outranks a reason about one of the people
// behind it.
export const skipInstruction = (target: RoutePayloadTarget): string | null =>
  target.doNotKnock
    ? 'Do not knock — skip this door'
    : target.notAVoterReason
      ? NOT_A_VOTER_INSTRUCTIONS[target.notAVoterReason]
      : null

// The short marker a flagged resident carries wherever they are listed beside
// other people — the stop rows, the resident switcher, the household roster.
// ADR 0007 and 0008: it REPLACES the knock status rather than sitting beside
// it, because a flagged resident knocked before the flag was set still carries
// a status, and "Do not knock" next to "Support unknown" reads as two different
// answers to the same question. Do-not-knock wins a tie: it is an instruction
// about the door, not a fact about the person behind it.
//
// `NOT_A_VOTER_LABELS` is the CRM activity feed's vocabulary, reused here on
// purpose — the same flag should not be called two things in one product.
export const targetMarker = (target: RoutePayloadTarget): string | null =>
  target.doNotKnock
    ? 'Do not knock'
    : target.notAVoterReason
      ? NOT_A_VOTER_LABELS[target.notAVoterReason]
      : null
