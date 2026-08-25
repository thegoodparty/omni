import {
  DoorKnockStatus,
  RoutePayloadTarget,
  RouteTargetActivity,
  SUPPORT_STATUS_ROLLUP_LABELS,
} from '@goodparty_org/contracts'

// Where the resident stands, if the status says anything about it at all.
//
// `DoorKnockStatus` is one enum carrying two kinds of fact: what happened at
// the door (not_home, inaccessible, refused, not_a_voter) and what the person
// said when it opened (supporter, non_supporter). Only the second pair is a
// support level, so only that pair can be stated as one — and `unknown` is
// deliberately not in it, because `deriveKnockStatus` collapses three
// different things into it: never knocked, answered-but-no-answer-given, and
// an explicit `unsure`. A card reading "Support unknown" over a resident
// nobody has ever visited would state a finding where there is no observation,
// which is why the card is silent rather than filled in with the grey status
// the rosters print (they list people side by side and need a value per row;
// this states one fact about one person, and has the option of not making a
// claim).
//
// `refused` is the near miss, and it stays out for a reason worth writing
// down: the CRM's support vocabulary has a `refused` member of its own
// (`SUPPORT_STATUS_ROLLUP_LABELS`), so an override can land here — but so can
// a `refused_to_engage` door, through `deriveKnockStatus`. One status, two
// meanings, and the card cannot tell them apart, so calling it a support level
// would sometimes be reporting an outcome as a stance.
export type SupportStatus = Extract<
  DoorKnockStatus,
  'supporter' | 'non_supporter'
>

export const supportStatus = (status: DoorKnockStatus): SupportStatus | null =>
  status === 'supporter' || status === 'non_supporter' ? status : null

// Month and year, on the canvasser's own clock. Local rather than the UTC the
// paper surfaces pin themselves to (`walkFacts.ts`), because those render in
// Node — where the clock is UTC and a door knocked at 9pm anywhere in the US
// would print as the next day — while this renders in the browser of the phone
// held at the door.
//
// A month rather than a timestamp: the activity feed one card away already
// carries the exact time and the author, so the only thing this line has to
// add is how fresh the answer is. It is also the granularity ADR 0009 argued
// the door's history at — "we spoke in June about the sidewalks".
const supportMonth = new Intl.DateTimeFormat('en-US', {
  month: 'long',
  year: 'numeric',
})

// What one history row says about support, or null when it says nothing about
// it. `'other'` is a row that DOES speak to support but names neither of the
// two the card can show (an `unsure` answer, an `Undecided`/`Refused`
// override): not a match, and — per `supportAsOf` below — not something to
// read past either.
type SupportClaim = SupportStatus | 'other'

const supportClaim = (activity: RouteTargetActivity): SupportClaim | null => {
  switch (activity.type) {
    case 'DOOR_KNOCK': {
      const answer = activity.data.supportAnswer
      if (answer === null) return null
      return answer === 'supporter' || answer === 'non_supporter'
        ? answer
        : 'other'
    }
    // The override half of the status, and the half that wins:
    // `latestKnockStatuses` prefers a manual support_status override over any
    // interaction, so the row that set it is the row that dates the card.
    // Matched on the resolved label because that is all the feed row carries —
    // `SUPPORT_STATUS_ROLLUP_LABELS` is the server's own map, imported rather
    // than restated so the two cannot word one value differently.
    case 'STATUS_CHANGE': {
      if (activity.data.field !== 'support_status') return null
      const { toLabel } = activity.data
      if (toLabel === SUPPORT_STATUS_ROLLUP_LABELS.supporter) return 'supporter'
      if (toLabel === SUPPORT_STATUS_ROLLUP_LABELS.non_supporter) {
        return 'non_supporter'
      }
      return 'other'
    }
    default:
      return null
  }
}

// When the resident said it, or null when the payload cannot say — and null is
// the ordinary answer rather than the edge one, so the card has to read well
// without it.
//
// The date is never derived from the status itself, which carries none: it is
// read off the newest history row that speaks to support, and only if that row
// states the status being shown. Scanning stops at the FIRST such row rather
// than hunting for one that agrees, because a newer answer supersedes an older
// one — an override for this resident that fell outside ADR 0009's five-row
// window would otherwise let a June door knock date a stance recorded in
// August. Disagreement therefore means silence, not an older date.
//
// Absent history is a fact about the payload and not about the person: a route
// the service worker snapshotted before ADR 0009 shipped carries no `history`
// key at all, and the phone holding it cannot refetch. Same reason
// `lastContactLine` prints nothing rather than "never contacted".
export const supportAsOf = (
  target: RoutePayloadTarget,
  status: SupportStatus,
): string | null => {
  for (const activity of target.history ?? []) {
    const claim = supportClaim(activity)
    if (claim === null) continue
    const when = new Date(activity.date)
    if (claim !== status || Number.isNaN(when.getTime())) return null
    return supportMonth.format(when)
  }
  return null
}
