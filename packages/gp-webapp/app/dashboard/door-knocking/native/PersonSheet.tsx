'use client'

import { useEffect, useRef } from 'react'
import {
  ContactNote,
  DoorKnockStatus,
  NotAVoterReason,
  RoutePayloadStop,
  RoutePayloadTarget,
} from '@goodparty_org/contracts'
import {
  BadgeCheckIcon,
  Button,
  ChevronLeftIcon,
  ChevronRightIcon,
  ClipboardListIcon,
  ContactRoundIcon,
  DoorClosedIcon,
  FolderOpenIcon,
  HouseIcon,
  IconButton,
  MapPinIcon,
  UserIcon,
  XMarkIcon,
} from '@styleguide'
import SheetSectionHeader from './SheetSectionHeader'
import {
  NOT_ON_FILE,
  demographicFacts,
  voterDemographicFacts,
} from './demographicFacts'
import RecordKnockForm from './RecordKnockForm'
import {
  FOLLOW_UP_OPTIONS,
  FOLLOW_UP_QUESTION,
  SUPPORT_OPTIONS,
  SUPPORT_QUESTION,
} from './knockQuestions'
import DoorScript from './DoorScript'
import { useDoorScript } from './useDoorScript'
import { useDoorKnockingServeMode } from './doorKnockingSurface'
import DoNotKnockControl from './DoNotKnockControl'
import NotAVoterControl from './NotAVoterControl'
import ActivityFeedCard from './ActivityFeedCard'
import DoorNotesCard from './DoorNotesCard'
import { seedDoorNotes } from './doorNotes'
import {
  STATUS_DOT_COLORS,
  statusLabel,
  targetMarker,
} from './statusPresentation'
import {
  followUpAnswerFor,
  supportAsOf,
  supportStatus,
} from './supportPresentation'

const StatusDot = ({ status }: { status: DoorKnockStatus }) => (
  <span
    className="h-2 w-2 shrink-0 rounded-full"
    style={{ backgroundColor: STATUS_DOT_COLORS[status] }}
  />
)

// ADR 0007 and 0008. Both rosters below list a flagged resident alongside
// people who are still to knock, so both replace the status with the marker —
// the same rule the walk list follows. Without it the stop list says "Do not
// knock" and this sheet, one tap later, says "Support unknown" about the same
// person: two answers to the same question, which is the contradiction the
// marker exists to prevent.
const ResidentMarker = ({ marker }: { marker: string }) => (
  <span className="shrink-0 text-xs font-medium text-warning">{marker}</span>
)

// The canvas's `panelField`: label over value, one column, both at the same
// size. Two columns fitted more rows onto a phone, but a grid of pairs reads as
// a table to be cross-referenced rather than as a profile to be scanned, and
// the canvas draws every card in this panel as a single column.
const FactRow = ({ label, value }: { label: string; value: string }) => (
  <div>
    <p className="text-sm text-muted-foreground">{label}</p>
    <p className="text-sm font-medium">{value}</p>
  </div>
)

const FactCard = ({
  icon,
  title,
  facts,
}: {
  icon: React.ComponentType<{ size?: number; className?: string }>
  title: string
  facts: Array<{ label: string; value: string }>
}) => (
  <section className="mb-4 rounded-xl border border-border">
    <SheetSectionHeader icon={icon} title={title} />
    <div className="flex flex-col gap-4 p-4">
      {facts.map(({ label, value }) => (
        <FactRow key={label} label={label} value={value} />
      ))}
    </div>
  </section>
)

// The canvas's "Voter support" card: where this resident stands, stated as a
// current fact. Without it the panel went from the header straight to the form,
// so a canvasser walking up to a door a teammate knocked last week could only
// find out by scrolling to the activity feed and reading a row — at the one
// moment they are deciding what to open with.
//
// **It states support and nothing else.** `supportStatus` is silent for every
// status that carries no support signal (never knocked, not home, inaccessible,
// refused, not a voter), because a card is a claim and those are all doors with
// no answer behind them; an empty card, or one reading "Support unknown", would
// turn the absence of an observation into one. The date is the same rule again:
// it comes off the resident's own activity history when a row there states this
// support answer, and the line is simply absent when nothing does — the status
// on the payload carries no timestamp of its own and inventing one would date a
// stance to whenever the walk happened to be served.
//
// **The row is the canvas's `panelField('Do they support you?', …)`** — the
// knock form's own question, answered in the knock form's own words. The canvas
// writes the value through `PB_SUPPORT_LABEL` (Yes / No / Unsure), and the
// vocabulary is already in this feature as `SUPPORT_OPTIONS`, so the card reads
// it from there rather than restating it: the question a canvasser was asked at
// the door and the answer read back a week later are then literally the same
// two strings. `STATUS_LABELS`' "Supporter" / "Non-supporter" stays where it
// belongs — on the rosters and the legend, where a row in a list of people
// needs a noun rather than an answer to a question that isn't printed beside it.
//
// **Will-vote is deliberately not here**, and this is the one place the card
// departs from the canvas's field list. The canvas draws a second row,
// `panelField('Will they vote?', …)`, and `RecordKnockForm` does ask the
// question — but the answer only lives in the CRM interaction: nothing derives
// it onto `knockStatus` the way support is derived, so there is no current value
// to state and "Not logged" would be false for every resident who has actually
// answered it. Recorded as still open in `AGENTS.md` rather than approximated
// from the most recent knock, which would quietly report one canvasser's answer
// as the resident's standing position.
//
// ADR 0007 and 0008: withheld for a flagged resident. That is `targetMarker`'s
// rule at panel scale — the marker REPLACES the status rather than sitting
// beside it, and "Supporter" over a door whose footer says "asked not to be
// visited again" is exactly the pair of answers to one question the rule exists
// to prevent. It used to be withheld structurally, by living inside the footer
// branch that also withholds the script and the form; the card now sits in the
// body where the canvas draws it, so the footer's flag control is resolved once
// and the body renders this card only when there is none. Still one predicate,
// just named instead of implied — see `flagControl` below.
const VoterSupportCard = ({
  target,
  status,
}: {
  target: RoutePayloadTarget
  status: DoorKnockStatus
}) => {
  const support = supportStatus(status)
  if (!support) return null
  const asOf = supportAsOf(target, support)
  const answer = SUPPORT_OPTIONS.find(([option]) => option === support)?.[1]
  return (
    <section className="mb-4 rounded-xl border border-border">
      <SheetSectionHeader icon={BadgeCheckIcon} title="Voter support" />
      <div className="flex flex-col gap-4 p-4">
        <FactRow label={SUPPORT_QUESTION} value={answer ?? NOT_ON_FILE} />
        {/* Not a canvas row. The status carries no timestamp, so this is read
            off the resident's own history and is simply absent when nothing
            there states the answer being shown — see `supportAsOf`. */}
        {asOf && <p className="text-sm text-muted-foreground">As of {asOf}</p>}
      </div>
    </section>
  )
}

// The Serve surface's version of the card above, and it makes the same claim
// under the same rule: silent unless the status came from a follow-up answer,
// because every other status is a door nobody had a conversation at.
//
// **No "As of" line.** Support gets one by reading the resident's history for a
// row that states the same answer, and `RouteTargetActivity`'s door-knock row
// carries `supportAnswer` and nothing about follow-up — so there is no row here
// that could date this. Absent rather than approximated from the newest knock,
// which is the same call `supportAsOf` documents: a date read off a row that
// does not state the answer being shown is a date attached to the wrong visit.
// If a Serve official asks for one, the history row is where it comes from.
const FollowUpCard = ({ status }: { status: DoorKnockStatus }) => {
  const followUp = followUpAnswerFor(status)
  if (!followUp) return null
  const answer = FOLLOW_UP_OPTIONS.find(([option]) => option === followUp)?.[1]
  return (
    <section className="mb-4 rounded-xl border border-border">
      <SheetSectionHeader icon={BadgeCheckIcon} title="Follow-up" />
      <div className="flex flex-col gap-4 p-4">
        <FactRow label={FOLLOW_UP_QUESTION} value={answer ?? NOT_ON_FILE} />
      </div>
    </section>
  )
}

interface PersonSheetProps {
  stop: RoutePayloadStop
  // Controlled by WalkView rather than held here, because auto-advance moves
  // between residents of one household without the sheet closing — internal
  // state would keep showing the person who was just logged.
  selectedTargetId: number
  onSelectTarget: (targetId: number) => void
  statusFor: (target: RoutePayloadTarget) => DoorKnockStatus
  clientKeyFor: (targetId: number) => string
  onRecorded: (
    targetId: number,
    personId: string,
    knockStatus: DoorKnockStatus,
  ) => void
  // ADR 0011. Reported up rather than applied here, for the reason the knock
  // status is: `WalkView` writes them into the cached route payload, so the
  // list this sheet renders is the same list a reopened sheet renders.
  onNoteCreated: (personId: string, note: ContactNote) => void
  onNoteUpdated: (personId: string, note: ContactNote) => void
  onNoteDeleted: (personId: string, noteId: string) => void
  onDoNotKnockChanged: (personId: string, doNotKnock: boolean) => void
  onNotAVoterChanged: (
    personId: string,
    reason: NotAVoterReason | undefined,
  ) => void
  onClose: () => void
  // Door-to-door navigation, the canvas's own panel header
  // (`navBtn('chevron-left', ()=>this.openPanel(route[idx-1].id), hasPrev)`).
  // Null at the ends of the route, which renders the control disabled rather
  // than absent: a chevron that vanishes at the last door is indistinguishable
  // from a chevron that failed.
  //
  // This is NOT the auto-advance rule relaxed. `advanceFrom` stays forward-only
  // because it moves the canvasser without being asked, and sending them back
  // up the street they just walked is the thing it must not do. These are asked
  // for, and going back a door is already possible from the stop list — this is
  // the same act without closing the sheet, which is the whole point at a
  // doorstep with one hand full.
  onOpenPreviousStop: (() => void) | null
  onOpenNextStop: (() => void) | null
  // The stop's own number, as the walk list, the map's pin layer and the
  // printed sheet all draw it (`stop.seq`, never an index). The canvas puts it
  // in this header for the same reason it puts it on the pin: it is how a
  // canvasser says where they are.
  stopSeq: number
  // Which surface this walk belongs to, off the route payload's own `isServe`
  // rather than the page's context: this sheet is mounted by tests and by
  // surfaces with no organization provider above them, and the payload is the
  // one thing every reader of a served route already holds.
  isServe: boolean
}

// The demo's person sheet: a right panel on desktop, a bottom sheet on
// small screens. Talking points are the candidate's own saved issues, not the
// AI copy the demo implied.
//
// Phones are live-only and screen-only. The route payload carries them for a
// target that still has a live row, which is the same rule mayHaveMoved is
// derived from — so a mover shows no number rather than one belonging to
// whoever lives there now. They are deliberately absent from the printed walk
// sheet, which leaves the building.
const digitsOnly = (phone: string): string => phone.replace(/\D/g, '')

// A `panelField` whose value happens to be dialable. The canvas draws both
// phone rows unconditionally and writes the empty one as a value rather than
// dropping it (`panelField('Landline','Unknown')`), which is the better shape:
// a card that silently loses a row states nothing about whether the number was
// looked for, and the two rows are also the only place this card can say the
// number is missing now that it has no sentence of its own.
//
// The absent value is `NOT_ON_FILE` and not the canvas's "Unknown", because
// this panel already has one word for an empty voter-file column and it is the
// one the two fact cards below print nine and three times over. Two vocabularies
// for absence, one card apart, teaches a reader that the boundary means
// something — which is exactly the argument `demographicFacts.ts` makes about
// its own two cards.
const PhoneRow = ({
  label,
  phone,
}: {
  label: string
  phone: string | null | undefined
}) => (
  <div>
    <p className="text-sm text-muted-foreground">{label}</p>
    {phone ? (
      // Tappable: the point of a number at the door is calling it from the
      // phone already in the canvasser's hand.
      <a
        className="text-sm font-medium underline"
        href={`tel:${digitsOnly(phone)}`}
      >
        {phone}
      </a>
    ) : (
      <p className="text-sm font-medium">{NOT_ON_FILE}</p>
    )}
  </div>
)

export default function PersonSheet({
  stop,
  selectedTargetId,
  onSelectTarget,
  statusFor,
  clientKeyFor,
  onRecorded,
  onNoteCreated,
  onNoteUpdated,
  onNoteDeleted,
  onDoNotKnockChanged,
  onNotAVoterChanged,
  onClose,
  onOpenPreviousStop,
  onOpenNextStop,
  stopSeq,
  isServe,
}: PersonSheetProps) {
  const targets = stop.addresses.flatMap((address) => address.targets)
  // The chevrons move the sheet from door to door without unmounting it, so the
  // scrolling body keeps whatever offset the last house was read at — a
  // canvasser who scrolled down to the activity feed would arrive at the next
  // house already past the address, the phones and Open in Maps, which is the
  // half of this panel they need first at a door. Reset on the STOP, not on the
  // selected resident: switching residents at one door is a lateral move within
  // the same page of content, and yanking the view to the top under a finger
  // that just picked a housemate is its own bug.
  const bodyRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (bodyRef.current) bodyRef.current.scrollTop = 0
  }, [stop.id])
  const script = useDoorScript()
  // Serve's script is the opener alone: the bulleted stances under it are the
  // candidate's own, from an issues editor an elected official has no campaign
  // to have written in. `useDoorScript` builds the Serve sentence from the
  // office rather than leaving this card to self-hide on the empty fields a
  // Serve org produces, which is what it used to do.
  const serveMode = useDoorKnockingServeMode()
  const target =
    targets.find((candidate) => candidate.stopTargetId === selectedTargetId) ??
    targets[0]
  if (!target) return null
  const otherResidents = stop.addresses.flatMap(
    (address) => address.otherResidents,
  )
  const addressOfTarget = stop.addresses.find((address) =>
    address.targets.some(
      (candidate) => candidate.stopTargetId === target.stopTargetId,
    ),
  )

  // ADR 0007 and 0008, resolved once for the whole sheet. A flagged door has
  // nothing to say and nothing to log, so the footer swaps the script, the form
  // and the two follow-ups for the flag's own control — and the body's support
  // card is withheld by the presence of that control rather than by a second
  // reading of the same two fields, which is what would drift.
  const flagControl = target.doNotKnock ? (
    <DoNotKnockControl
      key={target.stopTargetId}
      target={target}
      onChanged={onDoNotKnockChanged}
    />
  ) : target.notAVoterReason ? (
    <NotAVoterControl
      key={target.stopTargetId}
      target={target}
      onChanged={onNotAVoterChanged}
    />
  ) : null

  return (
    <>
      <button
        type="button"
        aria-label="Close person details"
        className="fixed inset-0 z-30 bg-foreground/20"
        onClick={onClose}
      />
      <div className="fixed z-40 flex flex-col bg-background shadow-xl max-lg:inset-x-0 max-lg:bottom-0 max-lg:max-h-[85dvh] max-lg:rounded-t-xl lg:bottom-0 lg:right-0 lg:top-0 lg:w-[430px] lg:border-l lg:border-border">
        {/* 20px of horizontal padding through all three bands, which is
            `renderPanel`'s: the header, the scrolling body (`padding:'0 20px
            16px'`) and the sticky log bar (`'12px 20px 16px'`) all measure from
            the same edge, so a card's border and the name above it line up. */}
        <div className="flex flex-col gap-3 border-b border-border px-5 py-4">
          <div className="flex items-start gap-2">
            {/* The canvas's panel header: back, the stop's number, the person,
                forward. Both chevrons are rendered at every position and
                disabled at the ends, so the pair keeps its place in the row
                and the header does not reflow as the canvasser walks.
                `ghost` and not the default fill: three filled circles around
                the name made the chrome the loudest thing on a panel whose
                subject is the person, and the canvas draws all three as plain
                glyphs. The hit target is the IconButton's either way, which is
                the part that matters at a doorstep. */}
            <IconButton
              variant="ghost"
              aria-label="Previous door"
              disabled={onOpenPreviousStop === null}
              onClick={() => onOpenPreviousStop?.()}
            >
              <ChevronLeftIcon size={18} />
            </IconButton>
            {/* Same numeral the list row and the map pin draw for this stop. */}
            <span className="mt-1 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-bold tabular-nums text-primary-foreground">
              <span className="sr-only">Stop </span>
              {stopSeq}
            </span>
            <div className="min-w-0 flex-1">
              {/* The DOOR, not the person: `renderPanel` heads this panel with
                  `v.address` at 17/700 and leaves the names to the switcher
                  below. That is the right subject — the panel is opened from a
                  pin and closed at a doorstep, and a household of four opened
                  four panels titled four different ways under one knocker.
                  The person's own facts are all still here, in the switcher and
                  in the demographics cards. */}
              <h2 className="text-[17px] font-bold leading-tight">
                {stop.displayAddress}
              </h2>
              {/* A block of flats: which door of it, under the building's
                  address. The canvas's `doors.length>1 && …door.label`.
                  Conditioned on the door rather than on having sibling doors,
                  the same way the walk list's rows are — the heading above is
                  the building, so a lone apartment would otherwise be the one
                  door whose number is nowhere on the panel opened at it.

                  The address itself where there is no unit to name the door
                  by but it still is not the stop: a stop is a coordinate, and
                  two houses that geocode to one are two doors whose only
                  distinguishing mark is the street line the heading cannot
                  show for both. */}
              {addressOfTarget &&
                (addressOfTarget.unit ||
                  addressOfTarget.address !== stop.displayAddress) && (
                  <p className="mt-0.5 flex items-center gap-1 truncate text-[13px] font-medium text-muted-foreground">
                    <DoorClosedIcon
                      size={14}
                      aria-hidden="true"
                      className="shrink-0"
                    />
                    {addressOfTarget.unit || addressOfTarget.address}
                  </p>
                )}
            </div>
            <IconButton
              variant="ghost"
              aria-label="Next door"
              disabled={onOpenNextStop === null}
              onClick={() => onOpenNextStop?.()}
            >
              <ChevronRightIcon size={18} />
            </IconButton>
            <IconButton
              variant="ghost"
              aria-label="Close person details"
              onClick={onClose}
            >
              <XMarkIcon size={18} />
            </IconButton>
          </div>

          {/* In the header beside the name, not at the top of the scrolling
              body: the form is pinned to the footer, so a canvasser logging a
              door has usually scrolled the body past the switcher — and the one
              moment they need it is the one where they realize the person who
              opened the door is the housemate. Under the name because the name
              is what the switcher changes. */}
          {targets.length > 1 && (
            <div className="flex gap-1.5 overflow-x-auto rounded-lg bg-muted p-1.5">
              {targets.map((candidate) => {
                const marker = targetMarker(candidate)
                return (
                  <button
                    key={candidate.stopTargetId}
                    type="button"
                    aria-pressed={
                      candidate.stopTargetId === target.stopTargetId
                    }
                    className={`flex shrink-0 items-center gap-1.5 rounded-md px-3 py-1.5 text-sm ${
                      candidate.stopTargetId === target.stopTargetId
                        ? 'border border-border bg-background font-medium shadow-sm'
                        : ''
                    }`}
                    onClick={() => onSelectTarget(candidate.stopTargetId)}
                  >
                    {/* The tab strip holds names and status dots and reads as a
                        row of filter chips until something says the tabs are
                        people. Decorative, per the section headers. */}
                    <UserIcon
                      size={12}
                      aria-hidden="true"
                      className="shrink-0 text-muted-foreground"
                    />
                    {candidate.name ?? 'Unnamed'}
                    {marker ? (
                      <ResidentMarker marker={marker} />
                    ) : (
                      <StatusDot status={statusFor(candidate)} />
                    )}
                  </button>
                )
              })}
            </div>
          )}
          {/* One resident means no switcher, and the switcher is where a
              household's statuses are read — so the canvas prints the one
              status on its own line instead (`residents.length<=1 && prev`).
              A flagged resident's marker replaces it, the rule every roster in
              this feature follows. */}
          {targets.length === 1 &&
            (targetMarker(target) ? (
              <ResidentMarker marker={targetMarker(target) as string} />
            ) : (
              <span className="inline-flex items-center gap-1.5 text-[13px] text-muted-foreground">
                <StatusDot status={statusFor(target)} />
                Last: {statusLabel(statusFor(target), isServe)}
              </span>
            ))}
        </div>

        {/* `renderPanel`'s card sequence, in its order: Talking points, Contact
            information, Household, Voter demographics, Voter support,
            Demographic information, Notes, Activity Feed. That is the Win
            order — in serve mode the first card is headed Introduction and
            carries the opener alone (see `serveMode` above), the fourth is
            headed for a constituent, and the fifth is Follow-up in place of
            Voter support. The sequence itself is the same on both rails.

            **Notes moving to seventh reverses a position ADR 0011 recorded.**
            The ADR argued it second, above the profile, because it is the only
            card here read BEFORE the knock — "dog in the yard, use the side
            gate" under a dozen rows of reference material is a note nobody
            standing at a gate finds. That argument is unchanged and is worth
            re-reading before this moves again; what overrules it is the design
            call that this panel's card order is the canvas's. Nothing about the
            card itself moved: it is still per-resident, still reads off the
            payload, still writes straight to the CRM, and still renders for a
            flagged resident whose footer is withheld. */}
        <div ref={bodyRef} className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {/* First in the body, where the canvas draws it — it used to be a
              collapsed disclosure pinned above the form. Withheld for a flagged
              resident, by the same `flagControl` predicate the support card
              reads: a door nobody should knock has nothing to open with. Drawn
              on both surfaces otherwise: Serve's card is one sentence — see
              `serveMode` above — and one sentence is what an official's
              canvasser most needs, since the thing they have to say at a door
              they cannot invent is whose door-knocker they are. */}
          {flagControl === null && (
            <DoorScript
              intro={script.intro}
              issues={script.issues}
              isServe={serveMode}
            />
          )}

          <section className="mb-4 rounded-xl border border-border">
            <SheetSectionHeader
              icon={ContactRoundIcon}
              title="Contact information"
            />
            <div className="flex flex-col gap-4 p-4 text-sm">
              <div>
                <p className="text-sm text-muted-foreground">Address</p>
                {/* This resident's whole address, unit included, and the one
                    place on the panel that spells it out. The heading is the
                    building and the line under it is the unit, which is the
                    right split for reading a list at a doorstep and the wrong
                    one for the field a canvasser copies into a CRM note or
                    reads down a phone. */}
                <p className="text-sm font-medium">
                  {addressOfTarget?.address ?? stop.displayAddress}
                </p>
              </div>
              {/* Second, immediately under the address, where the canvas puts
                  it — the address and the way to get there are one thought.

                  Google's documented universal maps URL, which hands off to the
                  Maps app on both phone platforms rather than opening a web map
                  in a tab over the walk. The query is the STOP's frozen
                  coordinates, not its address text: the route was built from
                  them, and a rural or newly-built door is exactly where a
                  geocoder searching the address string lands somewhere else.
                  New tab for the reason the printed sheet uses one — leaving
                  this tab unmounts the walk and discards its replay keys.

                  The canvas's own `DS.Button variant='outline'` at full width,
                  through `asChild` so it stays an anchor: a real link is what
                  makes the new tab and the middle-click work. */}
              <Button asChild variant="outline" className="w-full">
                <a
                  href={`https://www.google.com/maps/search/?api=1&query=${stop.lat},${stop.lng}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  <MapPinIcon size={16} /> Open in Maps
                </a>
              </Button>
              <PhoneRow label="Cell phone number" phone={target.cellPhone} />
              <PhoneRow label="Landline" phone={target.landline} />
              {/* Not a canvas line. A mover has no numbers and no demographic
                  profile because the serve has no live row to read them off —
                  not because the file is empty — and the rows above cannot say
                  which of the two blanks this is. */}
              {target.mayHaveMoved && (
                <p className="text-sm text-warning">
                  May have moved since this route was built.
                </p>
              )}
            </div>
          </section>

          {/* Third, where the canvas puts it. Who else is behind this door is a
              fact about the door, and it is read before the knock; the profile
              below is read during it. */}
          <section className="mb-4 rounded-xl border border-border">
            <SheetSectionHeader icon={HouseIcon} title="Household" />
            <div className="flex flex-col gap-2 p-4 text-sm">
              {targets.map((member) => {
                const marker = targetMarker(member)
                return (
                  <div
                    key={member.stopTargetId}
                    className="flex items-center justify-between"
                  >
                    <span className="truncate">
                      {member.name ?? 'Name unavailable'}
                    </span>
                    {marker ? (
                      <ResidentMarker marker={marker} />
                    ) : (
                      <span className="flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground">
                        <StatusDot status={statusFor(member)} />
                        {statusLabel(statusFor(member), isServe)}
                      </span>
                    )}
                  </div>
                )
              })}
              {otherResidents.map((resident, index) => (
                <div
                  key={`${resident.name ?? 'resident'}-${index}`}
                  className="flex items-center justify-between text-muted-foreground"
                >
                  <span className="truncate">
                    {resident.name ?? 'Resident'}
                  </span>
                  <span className="text-xs">Not targeted</span>
                </div>
              ))}
            </div>
          </section>

          {/* The canvas's three profile cards, in its order: the voter-file
              registration facts, then where this resident stands, then the
              personal profile. We drew the first and third as one grid with
              support pinned in the footer, which put "is this person on the
              roll" and "do they have children" in adjacent cells of the same
              table — two different kinds of claim, read as one list.

              All three are scoped to `target`, so switching resident switches
              them: these are facts about one person, and the switcher in the
              header is the only thing that should change them.

              Deliberately plain label-over-value rows: no badges and no per-row
              icons, because a decorated row reads as a thing to act on when
              this is reference material a canvasser scans mid-conversation.

              **Targets only, and screen only.** Other residents behind the same
              door stay name-only in the Household card above, and both paper
              surfaces omit all of it — see the AGENTS.md note. */}
          {/* The heading is the surface's word for the person, not for the
              data: the two rows underneath are voter-file columns on both
              rails, but an elected official is not knocking a voter — they are
              knocking someone they already represent, whether or not that
              person is on the roll. */}
          <FactCard
            icon={ClipboardListIcon}
            title={isServe ? 'Constituent demographics' : 'Voter demographics'}
            facts={voterDemographicFacts(target, isServe)}
          />

          {/* One card or the other, never both — the two read back answers to
              questions only one surface asks, and a route only carries one
              surface's answers. Each is silent for a status that came from
              neither, so the pair renders nothing at an unopened door. */}
          {flagControl === null &&
            (isServe ? (
              <FollowUpCard status={statusFor(target)} />
            ) : (
              <VoterSupportCard target={target} status={statusFor(target)} />
            ))}

          <FactCard
            icon={FolderOpenIcon}
            title="Demographic information"
            facts={demographicFacts(target)}
          />

          {/* ADR 0011, seventh, where the canvas draws Notes — see the sequence
              note at the top of this body for what that reversed and why.

              In the scrolling body rather than the footer fragment, for the same
              reason the activity feed is, and it is the same argument twice
              over: notes are the record of the person, not an action on them, so
              they keep rendering for a resident whose talking points and knock
              form are withheld. A do-not-knock flag set on the wrong resident is
              caught by reading what people have written about them, and a note
              saying "this is the son, not the registered voter" is precisely the
              kind of thing that would be hidden at the one moment it is worth
              reading.

              Keyed, unlike the feed beside it — not against a sibling
              collision, which it has none of out here, but because the card
              holds a draft and an open editor. Those belong to one resident:
              carrying half a typed sentence about Dorian across the switcher
              and offering it under Marisol's name is text about a named voter
              attached to the wrong one. The saved lists themselves survive the
              switch — and the sheet closing, and the door being reopened —
              because they are not held here at all: a write is reported up and
              lands in the cached route payload, which is where `target.notes`
              is read back from. One list per resident, and this card renders
              it. */}
          <DoorNotesCard
            key={target.stopTargetId}
            personId={target.personId}
            notes={seedDoorNotes(target.notes)}
            onCreated={(created) => onNoteCreated(target.personId, created)}
            onUpdated={(updated) => onNoteUpdated(target.personId, updated)}
            onDeleted={(noteId) => onNoteDeleted(target.personId, noteId)}
          />

          {/* ADR 0009. Scoped to `target`, so switching resident switches the
              feed — two people behind one door disagree, and attributing a
              housemate's refusal to whoever answered is worse than showing
              nothing.

              Here in the scrolling body with the other reference cards, not in
              the footer with the script and the form. That is what makes it
              survive a flag: the footer is the acting half of the sheet and is
              withheld for a do-not-knock or not-a-voter resident, while this
              half describes the person and always renders. Deliberate, not
              incidental — the feed is the only place the flag's own
              STATUS_CHANGE row appears, naming who set it and when. Withholding
              it on flagged residents would hide the provenance of the flag from
              exactly the person standing there wondering whether it is right,
              and a mis-tapped do-not-knock would then be unfalsifiable from the
              door. Suppressing the form stops a knock; suppressing the history
              stops someone noticing a mistake.

              Being outside the footer fragment is also why it carries no key:
              it has no mutating siblings to collide with. Moving it in there
              would need one namespaced like `not-a-voter-` and `do-not-knock-`
              are. */}
          <ActivityFeedCard history={target.history ?? []} />
        </div>

        {/* The canvas's sticky log bar: `borderTop`, the background colour, and
            `padding:'12px 20px 16px'` with 16px between its groups. It holds
            only what a canvasser ACTS on — the question ladder — now that the
            talking points card has moved to the top of the body where the canvas
            draws it. */}
        <div className="flex flex-col gap-4 border-t border-border px-5 pb-4 pt-3">
          {/* ADR 0007 and 0008. The form is withheld rather than disabled: a
              flagged door has nothing to log, and an inert set of pills invites
              someone to work out why they don't respond. `flagControl` is
              resolved above, where do-not-knock is checked first because it is
              the stronger instruction — it is about the door, not the
              resident. */}
          {flagControl ?? (
            <>
              {/* No heading over the ladder. The design's log bar starts
                  straight on the "Did they answer?" label, and a "Log this
                  door" line above a question that says the same thing is the
                  kind of copy this pass exists to remove. It survived one
                  round only because two suites used the string as their "is the
                  sheet open" sentinel; those now assert on the first question,
                  which is a better sentinel anyway — it is the thing the
                  canvasser is actually offered. */}
              <RecordKnockForm
                key={target.stopTargetId}
                target={target}
                clientKey={clientKeyFor(target.stopTargetId)}
                onRecorded={(personId, knockStatus) =>
                  onRecorded(target.stopTargetId, personId, knockStatus)
                }
              />
              {/* Below the form, because it is a follow-up to what the form
                  just recorded — it renders nothing until this door is logged
                  as `not_a_voter`. Namespaced: a bare stopTargetId would
                  collide with the form's key above, and React reconciles
                  same-key siblings as one child. It still needs a key so it
                  resets its mutation state when the canvasser switches
                  resident.

                  No `Don't knock again` beside it. The design's door has no
                  such control, and the flag it set is not going away with it:
                  a resident already flagged still gets the banner at the top
                  of this footer, with its Undo, and the CRM is still where the
                  flag is set. What is gone is a one-tap, permanent exclusion
                  sitting directly under the log form on a phone in the rain. */}
              <NotAVoterControl
                key={`not-a-voter-${target.stopTargetId}`}
                target={target}
                onChanged={onNotAVoterChanged}
              />
            </>
          )}
        </div>
      </div>
    </>
  )
}
