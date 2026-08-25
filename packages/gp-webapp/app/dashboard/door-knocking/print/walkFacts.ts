import type {
  DoorKnockingRoutePayload,
  RoutePayloadStop,
  RoutePayloadTarget,
  RouteTargetActivity,
} from '@goodparty_org/contracts'
import { formatDistance } from '../native/routeFormat'
import { OUTCOME_OPTIONS } from '../native/knockQuestions'
import { countDoors, knockableTargets } from '../routeCounts'

export const formatDuration = (seconds: number): string => {
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes} min`
  return `${Math.floor(minutes / 60)} hr ${minutes % 60} min`
}

// The walk sheet's columns, in the order both paper surfaces rule them. Widths
// are each surface's own — one is CSS percentages of a printed page and the
// other is points in a fixed-width grid — but the wording is a fact both must
// agree on, because a canvasser filling in one and a volunteer filling in the
// other are handing the same answers to the same transcriber. Quoted twice, per
// this directory's rule; putting it in `walkListRows` would reach the PDF only.
export const WALK_COLUMNS = {
  seq: '#',
  name: 'Name',
  age: 'Age',
  address: 'Address',
  answered: 'Answered',
  support: 'Support',
  willVote: 'Will vote',
  notes: 'Notes',
} as const

// The two sentences above the grid, in the order they are read. The first is how
// to fill the sheet in; the second is the one thing a canvasser loses a day's
// work by assuming. Both surfaces printed a version of the second already, in
// two different wordings — one route's paper saying the same thing two ways is
// exactly what this file exists to stop.
export const MARK_INSTRUCTION =
  'Mark each door by hand. Circle or tick a box, write short notes in the last column.'
export const RECORDS_NOTICE =
  'Answers already logged in the app are printed below. Log these doors in the app when you’re back online — nothing written here reaches your voter records on its own.'

// How long it takes to get from the previous stop to this one, or null for the
// first stop of a route and for any leg the route reports as zero.
//
// A fact about the *stop*, not the door and not the resident, so it prints once
// however many doors the stop holds — see `firstInStop` on both renderers. It is
// here rather than in either of them because the printable sheet has always shown
// it and the PDF never did, which is the divergence this file exists to stop: two
// artifacts of one route, one of them silent about why the stops are in the order
// they are in.
//
// The mode is deliberately not in the wording, though `WalkView` says "3m walk"
// per leg. On a screen each stop is a card in a scrolling list; on paper every
// leg on the sheet belongs to one route whose header already reads "Walking
// loop", so repeating walk-or-drive on all 150 rows spends the narrowest column
// on the page restating something stated above it. "from last" earns its two
// words instead, because the number sits in the address column and needs to say
// it is time spent getting there rather than time spent at the door.
export const legTravelLine = (stop: RoutePayloadStop): string | null =>
  stop.legSeconds > 0 ? `${formatDuration(stop.legSeconds)} from last` : null

// Party, and whether the address is stale. Age used to lead this line and now
// has a column of its own on both surfaces, so repeating it here would print a
// voter's age twice in one row.
export const describeTarget = (target: RoutePayloadTarget): string =>
  [target.politicalParty, target.mayHaveMoved ? 'may have moved' : null]
    .filter(Boolean)
    .join(' · ')

// Month and year, and formatted in UTC rather than by the ambient clock. Both
// paper surfaces render in Node, whose clock is UTC, so a door knocked at 9pm
// anywhere in the US would print as the following day — which is the same
// reason neither page stamps itself with today's date, and a consistently wrong
// day is not an improvement on a coarse right month. A month is also the
// granularity the feed was argued for at: "we spoke in June about the
// sidewalks" (ADR 0009).
const contactMonth = new Intl.DateTimeFormat('en-US', {
  timeZone: 'UTC',
  month: 'long',
  year: 'numeric',
})

// Paper's own outcome wording — the same labels as the tick-boxes further down
// the page and as the form the sheet is transcribed back into, so one knock
// isn't named two things on one sheet.
const OUTCOME_LABELS = new Map(OUTCOME_OPTIONS)

// What a row of the resident's history was, in the CRM feed's own channel
// words. `null` for anything that is not outreach: a STATUS_CHANGE row is a
// record edit (a flag set at a desk or at a door), not a contact, and
// `skipInstruction` already prints what a flag means for this resident.
const contactDescription = (activity: RouteTargetActivity): string | null => {
  switch (activity.type) {
    case 'DOOR_KNOCK':
      return `Door knock: ${
        OUTCOME_LABELS.get(activity.data.outcome) ?? activity.data.outcome
      }`
    case 'TEXT':
      return 'Text'
    case 'ROBOCALL':
      return 'Robocall'
    default:
      return null
  }
}

// ENG-10876, on the surface where it is still open. `deriveKnockStatus`
// collapses answered-but-unsure into `unknown` on purpose, so the door stays
// worth knocking — which leaves paper unable to tell that door from one nobody
// has ever been to, because both print an identical blank form. On screen ADR
// 0009's activity feed answers it; paper carried no history at all, and paper is
// the surface used when the app isn't.
//
// One line, and only the two facts a doorstep needs: when, and what happened.
// **Never the note** — free text about a named voter, on the surface that leaves
// the building and stops being access-controlled the moment it does. Same rule
// that keeps phone numbers off these two pages.
//
// Read by `WalkSheet` and by `walkListRows`, because the printable page builds
// its own blocks and the PDF reads a row model: one function is what stops the
// two formats wording the same history differently. Absent history prints
// nothing rather than "never contacted" — a route snapshotted offline before
// ADR 0009 shipped carries no `history` key at all, so absence is not a claim.
export const lastContactLine = (target: RoutePayloadTarget): string | null => {
  // Newest first and capped server-side (ADR 0009), so the first row that is
  // outreach rather than a record edit is the last contact.
  for (const activity of target.history ?? []) {
    const what = contactDescription(activity)
    const when = new Date(activity.date)
    if (what === null || Number.isNaN(when.getTime())) continue
    return `Last contact: ${contactMonth.format(when)} · ${what}`
  }
  return null
}

// The one sentence that states what the walk costs. The printed sheet's header
// and the downloadable PDF's subtitle are the same string from here, on top of
// the same `routeCounts` definitions the app uses — three surfaces quoting a
// route back to the same canvasser cannot afford to disagree about how many
// doors are in it, and they have before.
export const walkSummary = (
  stops: DoorKnockingRoutePayload['stops'],
  route: DoorKnockingRoutePayload['route'],
): string =>
  [
    `${stops.length} stops`,
    `${countDoors(stops)} doors`,
    `${knockableTargets(stops).length} people`,
    `${route.mode === 'walk' ? 'Walking' : 'Driving'}${route.loop ? ' loop' : ''}`,
    // Geoapify times the movement between stops and nothing at them — the jobs
    // we send it carry no per-stop duration. On paper, in a row that already
    // says how many doors there are, an unqualified duration reads as the cost
    // of the whole walk; at our own 45 doors an hour it is under half of it.
    // Naming it costs one word and is the same word the app's two screens use.
    `${formatDuration(route.totalSeconds)} travel`,
    formatDistance(route.totalMeters),
  ].join(' · ')
