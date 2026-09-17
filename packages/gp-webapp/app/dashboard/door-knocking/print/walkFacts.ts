import type {
  DoorKnockingRoutePayload,
  RoutePayloadStop,
  RoutePayloadTarget,
  RouteTargetActivity,
} from '@goodparty_org/contracts'
import { formatDistance } from '../native/routeFormat'
import {
  ANSWER_OPTIONS,
  ENGAGEMENT_OPTIONS,
  FOLLOW_UP_OPTIONS,
  FOLLOW_UP_QUESTION,
  OUTCOME_OPTIONS,
  OUTCOME_QUESTION,
  SUPPORT_OPTIONS,
  SUPPORT_QUESTION,
} from '../native/knockQuestions'
import { countDoors, knockableTargets } from '../routeCounts'

export const formatDuration = (seconds: number): string => {
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes} min`
  return `${Math.floor(minutes / 60)} hr ${minutes % 60} min`
}

// The walk sheet's grid: the columns in order, the heading each carries, and the
// share of the content width each gets. One table rather than two, which is a
// change — the two surfaces used to size themselves independently and justify
// every departure, and the design template rules one set of percentages that
// both can hold. A percentage is unit-free, so the printable page hands it
// straight to `<col>` and the PDF resolves it against its own content width.
//
// The headings are the app's own questions where the column asks one, so the
// sheet and the form a canvasser transcribes it back into read the same. Widths
// are quoted from the template's `<th style="width:…">` and sum to 99%, which is
// the template's own arithmetic: the point-based grid gets a point of slack
// rather than a row that overflows by a rounding error.
//
// `Notes` is charged last on both surfaces, because it is the column someone
// writes in.
export const WALK_COLUMNS = [
  { key: 'seq', label: '#', width: 2 },
  { key: 'name', label: 'Name', width: 15 },
  { key: 'age', label: 'Age', width: 4 },
  { key: 'address', label: 'Address', width: 13 },
  { key: 'phone', label: 'Phone', width: 10 },
  { key: 'answered', label: OUTCOME_QUESTION, width: 17 },
  { key: 'support', label: SUPPORT_QUESTION, width: 25 },
  { key: 'notes', label: 'Notes', width: 13 },
] as const satisfies ReadonlyArray<{
  key: string
  label: string
  width: number
}>

export type WalkColumnKey = (typeof WALK_COLUMNS)[number]['key']

// The same grid for a Serve walk, differing in the one heading whose question
// differs. Same key, same width: paper's column is "the answer column", and
// which question is printed over it is the only thing the surface changes.
// Sharing the key is what lets `ANSWER_COLUMN_KEYS`, the skip instruction's
// `colSpan` and the already-logged row stay one definition for both.
const SERVE_WALK_COLUMNS = WALK_COLUMNS.map((column) =>
  column.key === 'support' ? { ...column, label: FOLLOW_UP_QUESTION } : column,
) as unknown as typeof WALK_COLUMNS

// Which grid a sheet prints, off the payload's own `isServe`. Paper is the
// reason that flag is on the payload at all: `print/[turfId]` and its PDF
// sibling render server-side with no organization provider over them, so the
// route is the only thing on the page that knows which product it belongs to.
export const walkColumns = (isServe: boolean): typeof WALK_COLUMNS =>
  isServe ? SERVE_WALK_COLUMNS : WALK_COLUMNS

// The three answer columns a blank form fills, in order. What a skip
// instruction or an already-logged answer spans, on both surfaces.
export const ANSWER_COLUMN_KEYS = [
  'answered',
  'support',
  'notes',
] as const satisfies ReadonlyArray<WalkColumnKey>

// One option out of the form's own list, by value. The point is that a box on
// paper is never a label typed into a renderer: paper is transcribed back into
// `RecordKnockForm`, so an option the form has no value for is an answer the
// canvasser cannot file. Throws rather than falling back, because a value that
// left the form's list while this file still asks for it is exactly the drift
// the indirection exists to catch, and a silently missing box is a question the
// sheet stops asking without anyone noticing.
const option = <T extends string>(
  options: ReadonlyArray<readonly [T, string]>,
  value: T,
): readonly [T, string] => {
  const found = options.find(([key]) => key === value)
  if (found === undefined) throw new Error(`no knock option for ${value}`)
  return found
}

// The boxes under "Did they answer?" — the app's first question, unchanged and
// in its order.
export const ANSWERED_BOXES: ReadonlyArray<readonly [string, string]> =
  ANSWER_OPTIONS

// The boxes under "Do they support you?". Four, because paper cannot branch the
// way the app does: on screen a door that answered is asked whether it engaged
// before it is asked about support, and `Refused` is the one answer to that
// question a canvasser still has to be able to write down. So the two questions
// share a column, with `Refused` first — the ending — and the three real support
// answers after it.
//
// Both halves come from the form's own constants (`ENGAGEMENT_OPTIONS` and
// `SUPPORT_OPTIONS`), never from a list written out here.
export const SUPPORT_BOXES: ReadonlyArray<readonly [string, string]> = [
  option(ENGAGEMENT_OPTIONS, 'refused_to_engage'),
  ...SUPPORT_OPTIONS,
]

// The Serve column's boxes, built the same way and for the same reason:
// `Refused` is the engagement answer paper cannot branch to, and the follow-up
// answers are the ending. Three boxes rather than four, because the question
// itself is binary — see `FOLLOW_UP_OPTIONS`.
const FOLLOW_UP_BOXES: ReadonlyArray<readonly [string, string]> = [
  option(ENGAGEMENT_OPTIONS, 'refused_to_engage'),
  ...FOLLOW_UP_OPTIONS,
]

export const answerBoxes = (
  isServe: boolean,
): ReadonlyArray<readonly [string, string]> =>
  isServe ? FOLLOW_UP_BOXES : SUPPORT_BOXES

// The one sentence above the grid: how to fill the sheet in.
export const MARK_INSTRUCTION =
  'Mark each door by hand. Circle or tick a box, write short notes in the last column.'

// Screen only, and deliberately no longer on either printed surface. The
// template rules a single legend line and a two-item footer, so the notice that
// used to ride beside the legend now lives in the printable page's own
// `print:hidden` preamble — the block that tells someone to press Ctrl+P, which
// paper has no equivalent of and the template therefore has no opinion about.
// The fact it states is still true and still load-bearing: nothing written on a
// sheet reaches gp-api until a person re-keys it.
export const RECORDS_NOTICE =
  'Answers already logged in the app are printed below. Log these doors in the app when you’re back online — nothing written here reaches your voter records on its own.'

// The tagline both sheets are signed with, from the design template's footer.
// Quoted rather than typed twice, like every other string both surfaces state:
// the printable page and the PDF are two formats of one artifact and cannot be
// signed differently. Sentence case as the template writes it.
export const FOOTER_TAGLINE = 'empowering Independents'

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

// The number to try when the door doesn't answer, in the Phone column both
// surfaces now rule. Cell first and landline as the fallback, which is the
// order `PersonSheet` lists them in and the order a canvasser would try them;
// one column has room for one number, so the sheet picks rather than truncates.
//
// This reverses a decision, and the reversal is the design's rather than a
// drift: paper stops being access-controlled the moment it leaves the building,
// which is why phone numbers were kept off both sheets and why the demographic
// profile and the saved contact notes still are. The walk sheet template rules a
// Phone column, and a door that doesn't answer is the case it exists for. The
// narrower rule stands for everything else on the payload — the eleven
// demographic attributes and ADR 0011's notes are still screen-only, and the
// tests that assert their omission are unchanged.
//
// Null on a `mayHaveMoved` target, and not by a check here: phones are live-only
// on the payload, so a target with no live row carries neither number rather
// than one belonging to whoever lives there now.
export const targetPhone = (target: RoutePayloadTarget): string | null =>
  target.cellPhone ?? target.landline

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
// that keeps the demographic profile and ADR 0011's saved notes off these two
// pages; the Phone column is a deliberate exception to it and the only one.
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
