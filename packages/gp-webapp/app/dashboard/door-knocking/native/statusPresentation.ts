import {
  DOOR_KNOCK_STATUSES,
  DoorKnockStatus,
  NOT_A_VOTER_LABELS,
  NotAVoterReason,
  RoutePayloadStop,
  RoutePayloadTarget,
} from '@goodparty_org/contracts'
import { isKnockable, knockableTargets } from '../routeCounts'

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

// The order the walk states its outcomes in — the canvas's `PROGRESS_ORDER`
// (line 681 of `Voter Outreach.dc.html`): the two answers a door can give
// first, then still-to-knock, then the ways a door can fail to answer.
// `not_a_voter` is ours (ADR 0008) and has no canvas position, so it goes last,
// beside the other outcomes that are not a stance.
export const PROGRESS_LEGEND_ORDER: DoorKnockStatus[] = [
  'supporter',
  'non_supporter',
  'not_home',
  'unknown',
  'inaccessible',
  'refused',
  'not_a_voter',
]

// The same order, for the segments of the bar those words sit under — derived
// and not written out again, because a bar whose segments ran in a different
// order from the legend below it would be two accounts of one walk.
//
// `unknown` is the one status with no segment. It is the bar's own track
// showing through, which is what makes the bar readable as progress rather
// than as a stacked chart: what is coloured is what has been logged, what is
// grey is what is left, and the two always add up to the list. Drawn as a
// seventh segment it would fill the bar on a walk where nothing had happened
// yet — the canvas leaves it out for the same reason.
export const PROGRESS_STATUS_ORDER: DoorKnockStatus[] =
  PROGRESS_LEGEND_ORDER.filter((status) => status !== 'unknown')

// Whichever of white and black is legible ON a given fill, by WCAG's own
// relative-luminance formula; the crossover is 0.179. Two things in this feature
// print a mark on top of a fixed colour and must both invert with it — the stop
// numeral on its status circle (`stopNumeralColor`, and the map's pin numerals
// with it) and the tick inside a selected list-colour swatch. One rule, because
// two copies of it is how one of them ends up white on amber. Fixed hex rather
// than `text-foreground`: the fill underneath is a fixed hex too and does not
// follow the theme.
const linearChannel = (value: number): number => {
  const channel = value / 255
  return channel <= 0.03928
    ? channel / 12.92
    : ((channel + 0.055) / 1.055) ** 2.4
}

export const readableInkOn = (rgb: [number, number, number]): string => {
  const [red, green, blue] = rgb
  const luminance =
    0.2126 * linearChannel(red) +
    0.7152 * linearChannel(green) +
    0.0722 * linearChannel(blue)
  return luminance > 0.179 ? '#000000' : '#ffffff'
}

// The same question asked of a `#rrggbb` string, which is how the turf palette
// stores its colours.
export const readableInkOnHex = (hex: string): string => {
  const value = hex.replace('#', '')
  return readableInkOn([
    parseInt(value.slice(0, 2), 16),
    parseInt(value.slice(2, 4), 16),
    parseInt(value.slice(4, 6), 16),
  ])
}

// Most-actionable-first rollup, and the only one: an 'unknown' person keeps the
// whole stop knockable, and an empty stop rolls up to 'unknown'. The ranking is
// `DOOR_KNOCK_STATUSES`' own order rather than a second table beside it, so a
// status added to the vocabulary cannot arrive unranked.
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

// The other half of the rollup, and the reason it needs one: a stop where every
// resident is flagged rolls up over an empty list, so `rollupStopStatus` returns
// `unknown` — the same answer as a stop nobody has been to yet. That is correct
// as far as a status goes (there is no knock to report) but it is not the whole
// fact, and any surface showing only the status shows the two cases identically.
// A status and "is this a target at all" are two questions; `unknown` can only
// answer the first, which is why this is a second value rather than an eighth
// status. `WalkView`'s stop row pairs them ("Nobody to knock here" in place of
// the count and dots); the map pin is the surface that currently does not, and
// this is what it should read to.
export const stopIsKnockable = (stop: RoutePayloadStop): boolean =>
  stop.addresses.some((address) => address.targets.some(isKnockable))

// How a walk went, bucketed once for every surface that reports it. The walk's
// seven-count strip and the details drawer's outcome table are the same
// question asked of the same frozen route on two screens, so they read one
// derivation — a local closure per surface is how the walk and the drawer would
// come to describe one list differently, which is the failure `routeCounts.ts`
// makes the same argument about for doors.
//
// The denominator is `knockableTargets`, like every people figure in this
// feature: ADR 0007 do-not-knock and ADR 0008 not-a-voter residents are dropped,
// so these seven sum to the People stat rather than to a wider population, and
// the six non-`unknown` buckets sum to the people-logged figure. Every status is
// present at zero, because the vocabulary is fixed and "nobody refused" is an
// answer — a bucket that vanishes when it empties would make the table's own
// shape a fact about the list.
//
// `not_a_voter` is the one bucket whose membership is partial, and deliberately
// so. ADR 0008's follow-up is optional, so a resident logged not-a-voter at the
// door carries the status immediately and a `notAVoterReason` only once someone
// answers "what happened?" — which is what removes them from `knockableTargets`
// entirely. So this bucket counts exactly the doors where that outcome was
// recorded and the reason has not been given yet, and answering it moves that
// resident out of the whole table rather than into another row. Reporting them
// anywhere else would need a second, wider denominator on a surface whose point
// is that one denominator holds.
//
// Nothing here re-derives a status. `knockStatus` arrives already
// override-aware from gp-api's `doorKnockingStatus.service.ts`; a client twin of
// that derivation is the drift these helpers exist to prevent.
export const knockStatusCounts = (
  stops: RoutePayloadStop[],
): Record<DoorKnockStatus, number> => {
  const counts = Object.fromEntries(
    DOOR_KNOCK_STATUSES.map((status) => [status, 0]),
  ) as Record<DoorKnockStatus, number>
  for (const target of knockableTargets(stops)) {
    counts[target.knockStatus] += 1
  }
  return counts
}

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
