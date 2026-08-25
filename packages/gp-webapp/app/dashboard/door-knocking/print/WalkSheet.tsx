import { Fragment } from 'react'
import Image from 'next/image'
import {
  DoorKnockingRoutePayload,
  RoutePayloadAddress,
  RoutePayloadStop,
  RoutePayloadTarget,
} from '@goodparty_org/contracts'
import {
  OUTCOME_OPTIONS,
  SUPPORT_OPTIONS,
  WILL_VOTE_OPTIONS,
} from '../native/knockQuestions'
import { skipInstruction, STATUS_LABELS } from '../native/statusPresentation'
import {
  describeTarget,
  formatDuration,
  lastContactLine,
  MARK_INSTRUCTION,
  RECORDS_NOTICE,
  WALK_COLUMNS,
  walkSummary,
} from './walkFacts'
import './walkSheet.css'

// The columns, and the share of the page each gets. Percentages rather than the
// handoff's own, because two of its columns are not on this sheet — there is no
// Phone column (see below) and its four Support options are three here — and the
// space they would have taken has to go somewhere. It goes to Name and Notes:
// Name because it carries the party and the last-contact line beneath it, and
// Notes because it is the only column a canvasser writes prose in.
//
// `table-layout: fixed` makes these binding rather than advisory, which is the
// point: the widest street name on a route must not be able to squeeze the
// column someone is writing in.
const COLUMNS: Array<[label: string, width: string]> = [
  [WALK_COLUMNS.seq, '3%'],
  [WALK_COLUMNS.name, '23%'],
  [WALK_COLUMNS.age, '3%'],
  [WALK_COLUMNS.address, '16%'],
  [WALK_COLUMNS.answered, '18%'],
  [WALK_COLUMNS.support, '9.5%'],
  [WALK_COLUMNS.willVote, '9.5%'],
  [WALK_COLUMNS.notes, '18%'],
]

// An outlined square with its label beneath it, per the handoff. The label is
// below rather than beside so a three-option column can be narrow: side-by-side
// labels are what forced the PDF's old `Y N ?` abbreviations, and an abbreviated
// option is one a transcriber has to guess the meaning of.
//
// The options are always the form's own — `OUTCOME_OPTIONS`, `SUPPORT_OPTIONS`,
// `WILL_VOTE_OPTIONS` — never a list written out here. Paper is transcribed back
// into that form, so a box this sheet offers that the form does not is an answer
// the canvasser cannot file.
const MarkBoxes = ({
  options,
}: {
  options: ReadonlyArray<readonly [string, string]>
}) => (
  <span className="ws-boxes">
    {options.map(([value, label]) => (
      <span className="ws-opt" key={value}>
        <span className="ws-box" aria-hidden />
        <span>{label}</span>
      </span>
    ))}
  </span>
)

const residentNames = (address: RoutePayloadAddress): string[] =>
  address.otherResidents
    .map((resident) => resident.name)
    .filter((name): name is string => Boolean(name))

interface ResidentRowProps {
  target: RoutePayloadTarget
  // The stop number and the address are printed once per household and left
  // blank for everyone else behind that door — the same merge the PDF does. A
  // canvasser reads a filled stop cell as "walk here next", so repeating it per
  // person would turn one door into three stops.
  firstInHousehold: boolean
  seq: number | null
  address: string | null
  travel: string | null
  alsoHere: string | null
}

const ResidentRow = ({
  target,
  firstInHousehold,
  seq,
  address,
  travel,
  alsoHere,
}: ResidentRowProps) => {
  const meta = describeTarget(target)
  const lastContact = lastContactLine(target)
  // Already recorded in the app: print the answer instead of blank boxes, so a
  // door isn't knocked twice and a transcriber doesn't overwrite it.
  const recorded = target.knockStatus !== 'unknown'
  const skip = skipInstruction(target)

  return (
    <tr className={firstInHousehold ? undefined : 'ws-mate'}>
      <td className="ws-seq">{firstInHousehold && seq !== null ? seq : ''}</td>
      <td className="ws-name">
        <span className="ws-line">{target.name ?? 'Name unavailable'}</span>
        {meta !== '' && <span className="ws-sub">{meta}</span>}
        {/* ENG-10876. Under the name rather than in a column of its own: it is
            what the canvasser reads before deciding how to open, and it is a
            fact about the resident rather than about the form. The handoff has
            no line for it — see the `### Paper` section of AGENTS.md for why
            dropping it would regress a shipped fix. Same helper the PDF's row
            model reads, so the two formats cannot word one history two ways. */}
        {lastContact !== null && <span className="ws-sub">{lastContact}</span>}
      </td>
      {/* Its own column since the handoff, so it no longer competes with the
          party for room on the meta line. Empty rather than a dash when the
          voter file has no age: a canvasser reads anything in this cell as a
          fact about the person. */}
      <td className="ws-age">{target.age ?? ''}</td>
      <td className="ws-address">
        {firstInHousehold && (
          <>
            {address !== null && <span className="ws-line">{address}</span>}
            {travel !== null && <span className="ws-sub">{travel}</span>}
            {alsoHere !== null && <span className="ws-sub">{alsoHere}</span>}
          </>
        )}
      </td>
      {/* ADR 0007 and 0008. Turf evaluation keeps flagged people off new lists,
          but it cannot reach a route already frozen — and paper freezes again
          the moment it prints. The row stays so the sheet still matches the
          app's stop numbering; the boxes go, because there is nothing to ask.
          Checked before `recorded`: a flagged resident is not to be knocked
          whatever was logged there before. */}
      {skip !== null ? (
        <td className="ws-instruction" colSpan={4}>
          {skip}
        </td>
      ) : recorded ? (
        <td className="ws-logged" colSpan={4}>
          Already logged: {STATUS_LABELS[target.knockStatus]}
        </td>
      ) : (
        <>
          {/* All five outcomes, not the handoff's three. The handoff offers Yes
              / No / Moved; "Moved" is not a value this app's form accepts, and
              the two outcomes it drops (nobody home, refused) are the two most
              common results of knocking a door. */}
          <td>
            <MarkBoxes options={OUTCOME_OPTIONS} />
          </td>
          <td>
            <MarkBoxes options={SUPPORT_OPTIONS} />
          </td>
          {/* The handoff has no Will-vote column. Kept, because the app's form
              asks it and a sheet that cannot record an answer the form wants is
              a sheet that has to be walked twice. */}
          <td>
            <MarkBoxes options={WILL_VOTE_OPTIONS} />
          </td>
          {/* Empty and stays empty. This is the column the canvasser writes in;
              the ruled line the old layout drew inside it only limited them to
              one line of it. */}
          <td />
        </>
      )}
    </tr>
  )
}

// One stop can hold several addresses — a walkable multi-unit building routes as
// a single stop with one address per unit — and each address holds one or more
// residents. Flattened to rows here rather than nested, because the grid is one
// row per resident: the household is drawn by which cells are blank and by the
// dotted rule between them, not by nesting.
const stopRows = (stop: RoutePayloadStop) =>
  stop.addresses.flatMap((address) => {
    const others = residentNames(address)
    return address.targets.map((target, index) => ({
      key: target.stopTargetId,
      target,
      firstInHousehold: index === 0,
      seq: stop.seq,
      // With one address the stop's display address is the door; with several,
      // the unit is the only thing telling a canvasser which one to knock.
      address:
        stop.addresses.length > 1 ? address.address : stop.displayAddress,
      travel:
        stop.legSeconds > 0
          ? `${formatDuration(stop.legSeconds)} from last`
          : null,
      alsoHere: others.length > 0 ? `Also here: ${others.join(', ')}` : null,
    }))
  })

// The brand system's own horizontal logo, per the handoff's instruction to use
// the one already in the codebase rather than the file it shipped. This is the
// lockup that file draws — heart plus the `GoodParty.org` wordmark — and the
// same one `pdf/GoodPartyLogo.tsx` traces for the PDF footer, so the two paper
// surfaces are signed the same way. `black-logo.svg` is the other horizontal
// mark in `public/images` and is a different lockup.
const SheetFooter = () => (
  <div className="ws-foot">
    <Image
      src="/images/logo/logo.svg"
      alt="GoodParty.org"
      width={164}
      height={22}
      className="ws-logo"
      // A lazily-loaded footer on a sheet this long is a footer that prints as a
      // gap: the browser has no reason to fetch it before the dialog opens.
      priority
    />
    <span className="ws-tagline">Empowering people to run, win, and serve</span>
  </div>
)

interface WalkSheetProps {
  turfId: string
  turfName: string
  payload: DoorKnockingRoutePayload
}

// The paper fallback for a walk with no signal: the same route the walk view
// shows, laid out to be written on and transcribed back afterwards. It is
// deliberately a server component with no interactivity — a canvasser hitting
// this URL on a phone with one bar should get a printable page, not a hydration
// wait.
export default function WalkSheet({
  turfId,
  turfName,
  payload,
}: WalkSheetProps) {
  const stops = payload.stops.slice().sort((a, b) => a.seq - b.seq)

  return (
    <div className="ws mx-auto max-w-[10in] p-6 print:max-w-none print:p-0">
      <div className="mb-4 rounded border border-neutral-400 p-3 text-sm print:hidden">
        <p className="font-semibold">
          Print this page (Ctrl+P, or ⌘P on a Mac), then take it with you.
        </p>
        <p className="mt-1">{RECORDS_NOTICE}</p>
        {/* A plain link, not a button: the file is built by a route handler, so
            downloading it costs this page no JavaScript at all and works with
            scripting off. */}
        <p className="mt-2">
          <a
            href={`/dashboard/door-knocking/print/${turfId}/pdf`}
            className="font-semibold underline underline-offset-2"
          >
            Download PDF
          </a>{' '}
          for the same grid as a file — easier to hand a volunteer, and it
          numbers its own pages.
        </p>
      </div>

      <header className="ws-head">
        <div>
          <h1 className="ws-title">{turfName}</h1>
          {/* Stops, doors and people are three different numbers, and the PDF
              quotes the same sentence from the same helper — the app and the
              paper have reported different door counts for one route before. */}
          <p className="ws-desc">{walkSummary(stops, payload.route)}</p>
        </div>
        {/* Deliberately no printed date. This renders in Node, whose clock is
            UTC, so an evening print anywhere in the US would be stamped
            tomorrow — and formatting it as UTC only makes the wrong date a
            consistent one. The canvasser dates the sheet, which is both accurate
            and what people already do with paper.

            The page number is a blank for the same class of reason. The handoff
            asks for `counter(page) of counter(pages)`, and both counters only
            resolve inside an `@page` margin box — which is the one place a
            browser will not let a document put content. In flow content, as
            here, `counter(pages)` has no value at all and Chrome prints "Page 0
            of 0". Blanks are honest about which surface knows: the PDF numbers
            its own pages from `@react-pdf/renderer`'s render callback, because
            it is the surface that knows how many there are. */}
        <p className="ws-meta">
          <span>
            Canvasser <b>______________________</b>
          </span>
          <span>
            Date <b>____________</b>
          </span>
          <span>
            Page <b>____ of ____</b>
          </span>
        </p>
      </header>

      <p className="ws-legend">
        {MARK_INSTRUCTION} {RECORDS_NOTICE}
      </p>

      {stops.length === 0 ? (
        <p className="ws-empty">This route has no stops.</p>
      ) : (
        <table className="ws-table">
          <colgroup>
            {COLUMNS.map(([label, width]) => (
              <col key={label} style={{ width }} />
            ))}
          </colgroup>
          <thead>
            <tr>
              {COLUMNS.map(([label]) => (
                <th key={label} scope="col">
                  {label}
                </th>
              ))}
            </tr>
          </thead>
          {/* In `tfoot`, not after the table. A block after the table prints
              once, on the last page; `thead` and `tfoot` are the two regions
              every print engine repeats per page, and the signature belongs on
              every sheet a canvasser is holding — the route is sixteen of them
              and they get separated. */}
          <tfoot>
            <tr>
              <td colSpan={COLUMNS.length}>
                <SheetFooter />
              </td>
            </tr>
          </tfoot>
          <tbody>
            {stops.map((stop) => (
              <Fragment key={stop.id}>
                {stopRows(stop).map(({ key, ...row }) => (
                  <ResidentRow key={key} {...row} />
                ))}
              </Fragment>
            ))}
          </tbody>
        </table>
      )}

      {/* With no stops there is no table, so the signature has nothing to repeat
          inside and prints on its own. */}
      {stops.length === 0 && <SheetFooter />}
    </div>
  )
}
