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

// The columns, and the share of the page each gets. The handoff's own
// percentages wherever the column means the same thing on both — `# 2`, `Name
// 18`, `Age 4`, `Address 16` — and every departure measured rather than
// guessed, against a 960px content width (Letter landscape inside the handoff's
// half-inch margins) in the browser this sheet is printed from.
//
// Each departure is one of the collisions this sheet escalates rather than
// adopts:
//
//   - `Phone 11` is not here at all, and its share funds the `Will vote` column
//     the handoff drops and the app's form still asks.
//   - `#` is 3 rather than 2. The handoff renders 1 to 40 rows; a route here is
//     capped at 150 stops, and "150" at 9.5px does not fit the 19px that 2% of
//     the page comes to — it wrapped to two lines from stop 10 onward.
//   - `Answered` is 24 rather than 12, because this surface offers all five
//     outcomes where the handoff offers three. Five 12px boxes with their
//     labels beneath measure 226px laid out in one row, which is 23.5% — and
//     one row is what the handoff asks for.
//   - `Support` is 9 rather than 16, for the mirror-image reason: three options
//     against the handoff's four measure 79px, or 8.3%.
//   - `Notes` gives up the residual 5, to 18. It is the column a canvasser
//     writes in and the one worth protecting, so it is last to be charged and
//     everything above it is measured to the pixel to keep the bill small.
//
// What does not fit at any of these widths is the last-contact line, whose
// longest form runs about 224px against the 173px `Name` gets. It wraps to two
// lines of 8.5px, which costs height rather than information; widening `Name`
// far enough to hold it would have to come out of `Notes`.
//
// `table-layout: fixed` makes these binding rather than advisory, which is the
// point: the widest street name on a route must not be able to squeeze the
// column someone is writing in.
const COLUMNS: Array<[label: string, width: string]> = [
  [WALK_COLUMNS.seq, '3%'],
  [WALK_COLUMNS.name, '17%'],
  [WALK_COLUMNS.age, '4%'],
  [WALK_COLUMNS.address, '13%'],
  [WALK_COLUMNS.answered, '26%'],
  [WALK_COLUMNS.support, '10%'],
  [WALK_COLUMNS.willVote, '10%'],
  [WALK_COLUMNS.notes, '17%'],
]

// An outlined square with its label beneath it, per the handoff. The label is
// below rather than beside so a three-option column can be narrow: side-by-side
// labels are what forced the PDF's old `Y N ?` abbreviations, and an abbreviated
// option is one a transcriber has to guess the meaning of.
//
// The options are always the form's own — `OUTCOME_OPTIONS`, `SUPPORT_OPTIONS`,
// `WILL_VOTE_OPTIONS` — never a list written out here. Paper is transcribed back
// into that form, so a box this sheet offers that the form does not is an answer
// the canvasser cannot file. The design handoff's own lists (a four-way Strong /
// Lean / Undec / No support, and a "Moved" outcome) are an error in the handoff
// rather than a decision to reconcile: the Voter Outreach 2.0 canvas, which is
// this feature's source of truth, ticks `Yes / No / Unsure` for both follow-ups
// and has no "Moved" door outcome anywhere. See the `### Paper` section of
// AGENTS.md. The handoff's box *geometry* is what this component implements.
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
  // Three different scopes, and mixing any two of them misreads the route. The
  // **stop number** and the time from the last stop belong to the *stop*: a
  // canvasser reads a filled stop cell as "walk here next", so printing it again
  // for the second unit of one building turns one stop into two. The **address**
  // belongs to the *household*, because a walkable multi-unit building is one
  // stop with a door per unit and the unit is the only thing saying which to
  // knock. Everything else belongs to the resident. Same split as the PDF's row
  // model, which is where `firstInStop` and `firstInHousehold` come from.
  firstInStop: boolean
  firstInHousehold: boolean
  seq: number | null
  address: string | null
  travel: string | null
  alsoHere: string | null
}

const ResidentRow = ({
  target,
  firstInStop,
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
      <td className="ws-seq">{firstInStop && seq !== null ? seq : ''}</td>
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
            {/* Time from the previous stop, so it prints on the stop's first row
                and not again for a second unit in the same building. */}
            {firstInStop && travel !== null && (
              <span className="ws-sub">{travel}</span>
            )}
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
          {/* All five outcomes. Paper cannot branch the way the app's
              walkthrough does, so every ending it can reach has to be offered at
              once — and this surface has a whole column to spend on them. */}
          <td className="ws-marks">
            <MarkBoxes options={OUTCOME_OPTIONS} />
          </td>
          <td className="ws-marks">
            <MarkBoxes options={SUPPORT_OPTIONS} />
          </td>
          {/* The handoff has no Will-vote column; the canvas asks the question,
              so the handoff simply omitted it. Kept, because a sheet that cannot
              record an answer the form wants is a sheet that has to be walked
              twice. */}
          <td className="ws-marks">
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
const stopRows = (stop: RoutePayloadStop) => {
  // Counted across the whole stop rather than per address, because the stop
  // number is the stop's and a stop can hold several doors.
  let rowsSoFar = 0

  return stop.addresses.flatMap((address) => {
    const others = residentNames(address)
    return address.targets.map((target, index) => ({
      key: target.stopTargetId,
      target,
      firstInStop: rowsSoFar++ === 0,
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
}

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

interface SheetHeaderProps {
  turfName: string
  stops: RoutePayloadStop[]
  payload: DoorKnockingRoutePayload
}

const SheetHeader = ({ turfName, stops, payload }: SheetHeaderProps) => (
  <>
    <div className="ws-head">
      <div>
        <h1 className="ws-title">{turfName}</h1>
        {/* Stops, doors and people are three different numbers, and the PDF
            quotes the same sentence from the same helper — the app and the paper
            have reported different door counts for one route before. */}
        <p className="ws-desc">{walkSummary(stops, payload.route)}</p>
      </div>
      {/* Deliberately no printed date. This renders in Node, whose clock is UTC,
          so an evening print anywhere in the US would be stamped tomorrow — and
          formatting it as UTC only makes the wrong date a consistent one. The
          canvasser dates the sheet, which is both accurate and what people
          already do with paper.

          The page number is a blank for a harder reason. The handoff asks for
          `counter(page) of counter(pages)`, and `counter(pages)` resolves only
          inside an `@page` margin box — which no browser implements, and which
          is in any case the one place a document cannot put its own content. In
          flow content, the only place we can put it, Chrome resolves the counter
          to nothing and prints "Page 0 of 0": a number that is wrong where a
          blank would at least be honest. The PDF numbers its own pages from
          `@react-pdf/renderer`'s render callback, because it is the surface that
          knows how many there are — and a browser's print dialog offers page
          numbers of its own besides. */}
      <p className="ws-meta">
        <span>
          Canvasser <b>____________________</b>
        </span>
        <span>
          Date <b>____ / ____ / ______</b>
        </span>
        <span>
          Page <b>____ of ____</b>
        </span>
      </p>
    </div>
    <p className="ws-legend">
      {MARK_INSTRUCTION} {RECORDS_NOTICE}
    </p>
  </>
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

      {stops.length === 0 ? (
        <>
          <SheetHeader turfName={turfName} stops={stops} payload={payload} />
          <p className="ws-empty">This route has no stops.</p>
        </>
      ) : (
        <table className="ws-table">
          <colgroup>
            {COLUMNS.map(([label, width]) => (
              <col key={label} style={{ width }} />
            ))}
          </colgroup>
          {/* The handoff's header and legend repeat on every printed page. Its
              prototype gets that from a paged-media component with a `header`
              slot; a browser gives us exactly two regions it will repeat, and
              `thead` is the one at the top of the page. So the header rides
              inside the table rather than above it — flow content above a table
              prints once, on page one, and every page after it would carry a
              grid whose route has no name.

              A `td` rather than a `th`, because it is a banner and not the head
              of a column: eight `columnheader`s is what a screen reader and the
              tests should both find in here. */}
          <thead>
            <tr>
              <td className="ws-banner" colSpan={COLUMNS.length}>
                <SheetHeader
                  turfName={turfName}
                  stops={stops}
                  payload={payload}
                />
              </td>
            </tr>
            <tr className="ws-cols">
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
