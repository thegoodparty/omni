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
  ChevronLeftIcon,
  ChevronRightIcon,
  CircleUserRoundIcon,
  ClipboardListIcon,
  HouseIcon,
  IconButton,
  MapPinIcon,
  UserIcon,
  XMarkIcon,
} from '@styleguide'
import SheetSectionHeader from './SheetSectionHeader'
import { demographicFacts } from './demographicFacts'
import RecordKnockForm from './RecordKnockForm'
import DoorScript from './DoorScript'
import { useDoorScript } from './useDoorScript'
import DoNotKnockControl from './DoNotKnockControl'
import NotAVoterControl from './NotAVoterControl'
import ActivityFeedCard from './ActivityFeedCard'
import DoorNotesCard from './DoorNotesCard'
import { seedDoorNotes } from './doorNotes'
import {
  STATUS_DOT_COLORS,
  STATUS_LABELS,
  targetMarker,
} from './statusPresentation'

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

const PhoneRow = ({ label, phone }: { label: string; phone: string }) => (
  <div>
    <p className="text-xs text-muted-foreground">{label}</p>
    {/* Tappable: the point of a number at the door is calling it from the
        phone already in the canvasser's hand. */}
    <a className="underline" href={`tel:${digitsOnly(phone)}`}>
      {phone}
    </a>
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
  const target =
    targets.find((candidate) => candidate.stopTargetId === selectedTargetId) ??
    targets[0]
  if (!target) return null
  const otherResidents = stop.addresses.flatMap(
    (address) => address.otherResidents,
  )

  return (
    <>
      <button
        type="button"
        aria-label="Close person details"
        className="fixed inset-0 z-30 bg-foreground/20"
        onClick={onClose}
      />
      <div className="fixed z-40 flex flex-col bg-background shadow-xl max-lg:inset-x-0 max-lg:bottom-0 max-lg:max-h-[85dvh] max-lg:rounded-t-xl lg:bottom-0 lg:right-0 lg:top-0 lg:w-[430px] lg:border-l lg:border-border">
        <div className="flex flex-col gap-3 border-b border-border p-4">
          <div className="flex items-start gap-2">
            {/* The canvas's panel header: back, the stop's number, the person,
                forward. Both chevrons are rendered at every position and
                disabled at the ends, so the pair keeps its place in the row
                and the header does not reflow as the canvasser walks. */}
            <IconButton
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
              <h2 className="truncate text-xl font-semibold">
                {target.name ?? 'Name unavailable'}
              </h2>
              <p className="text-sm text-muted-foreground">
                {[
                  target.age !== null ? `${target.age} years old` : null,
                  target.politicalParty,
                ]
                  .filter(Boolean)
                  .join(' · ') || 'No details on file'}
              </p>
            </div>
            <IconButton
              aria-label="Next door"
              disabled={onOpenNextStop === null}
              onClick={() => onOpenNextStop?.()}
            >
              <ChevronRightIcon size={18} />
            </IconButton>
            <IconButton aria-label="Close person details" onClick={onClose}>
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
        </div>

        <div ref={bodyRef} className="min-h-0 flex-1 overflow-y-auto p-4">
          <section className="mb-4 rounded-lg border border-border">
            <SheetSectionHeader
              icon={CircleUserRoundIcon}
              title="Contact information"
            />
            <div className="flex flex-col gap-3 p-4 text-sm">
              <div>
                <p className="text-xs text-muted-foreground">Address</p>
                <p>{stop.displayAddress}</p>
              </div>
              {target.cellPhone && (
                <PhoneRow label="Cell phone" phone={target.cellPhone} />
              )}
              {target.landline && (
                <PhoneRow label="Landline" phone={target.landline} />
              )}
              {/* Only meaningful for someone we still have a live row for: a
                  mover has no number because the row is gone, not because the
                  file lacks one, and the moved warning below says so. */}
              {!target.cellPhone &&
                !target.landline &&
                !target.mayHaveMoved && (
                  <p className="text-xs text-muted-foreground">
                    No phone number on file.
                  </p>
                )}
              {/* Google's documented universal maps URL, which hands off to
                  the Maps app on both phone platforms rather than opening a web
                  map in a tab over the walk. The query is the STOP's frozen
                  coordinates, not its address text: the route was built from
                  them, and a rural or newly-built door is exactly where a
                  geocoder searching the address string lands somewhere else.
                  New tab for the reason the printed sheet uses one — leaving
                  this tab unmounts the walk and discards its replay keys. */}
              <a
                className="inline-flex items-center justify-center gap-2 rounded-full border border-border px-4 py-2 text-sm font-medium hover:bg-muted"
                href={`https://www.google.com/maps/search/?api=1&query=${stop.lat},${stop.lng}`}
                target="_blank"
                rel="noreferrer"
              >
                <MapPinIcon size={16} /> Open in Maps
              </a>
              {target.mayHaveMoved && (
                <p className="text-xs text-warning">
                  May have moved since this route was built.
                </p>
              )}
            </div>
          </section>

          {/* ADR 0011. Second in the body, above the demographic profile,
              because it is the only card here a canvasser reads BEFORE they
              knock: "dog in the yard, use the side gate" is the archetypal
              note, and putting it under eleven rows the comment below
              correctly calls reference material scanned mid-conversation is
              putting it where nobody standing at a gate will find it. Contact
              information keeps the top because the address and Open in Maps
              are what get someone to the door in the first place.

              In the scrolling body rather than the footer fragment, for the
              same reason the activity feed is, and it is the same argument
              twice over: notes are the record of the person, not an action on
              them, so they keep rendering for a resident whose script and knock
              form are withheld. A do-not-knock flag set on the wrong resident
              is caught by reading what people have written about them, and a
              note saying "this is the son, not the registered voter" is
              precisely the kind of thing that would be hidden at the one moment
              it is worth reading.

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

          {/* The prototype's demographic profile, scoped to `target` so
              switching resident switches the card — these are facts about one
              person, and the resident switcher above is the only thing that
              should change them.

              Deliberately plain label-over-value rows: no badges and no
              per-row icons, because eleven decorated rows read as eleven
              things to act on when they are reference material a canvasser
              scans mid-conversation. Two columns because eleven single-column
              rows push the Household card and the activity feed off a phone
              screen entirely.

              **Targets only, and screen only.** Other residents behind the
              same door stay name-only in the Household card below, and both
              paper surfaces omit all of this — see the AGENTS.md note. */}
          <section className="mb-4 rounded-lg border border-border">
            <SheetSectionHeader
              icon={ClipboardListIcon}
              title="Demographic information"
            />
            <div className="grid grid-cols-2 gap-3 p-4 text-sm">
              {demographicFacts(target).map(({ label, value }) => (
                <div key={label}>
                  <p className="text-xs text-muted-foreground">{label}</p>
                  <p className="font-medium">{value}</p>
                </div>
              ))}
            </div>
          </section>

          <section className="mb-4 rounded-lg border border-border">
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
                        {STATUS_LABELS[statusFor(member)]}
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

        <div className="flex flex-col gap-3 border-t border-border p-4">
          {/* ADR 0007 and 0008. The script and the form are withheld rather
              than disabled: a flagged door has nothing to say and nothing to
              log, and an inert set of pills invites someone to work out why
              they don't respond. Do-not-knock is checked first because it is
              the stronger instruction — it is about the door, not the
              resident. */}
          {target.doNotKnock ? (
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
          ) : (
            <>
              {/* Above the form, because it's what the canvasser says before
                  there is anything to log. */}
              <DoorScript intro={script.intro} issues={script.issues} />
              <h3 className="text-base font-semibold">Log this door</h3>
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
                  as `not_a_voter`. */}
              <NotAVoterControl
                key={`not-a-voter-${target.stopTargetId}`}
                target={target}
                onChanged={onNotAVoterChanged}
              />
              {/* Namespaced: a bare stopTargetId would collide with the
                  form's key above, and React reconciles same-key siblings as
                  one child. All three still need a key so each resets its
                  mutation state when the canvasser switches resident. */}
              <DoNotKnockControl
                key={`do-not-knock-${target.stopTargetId}`}
                target={target}
                onChanged={onDoNotKnockChanged}
              />
            </>
          )}
        </div>
      </div>
    </>
  )
}
