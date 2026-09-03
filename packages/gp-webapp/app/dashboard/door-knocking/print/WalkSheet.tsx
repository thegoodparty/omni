import { Fragment } from 'react'
import Image from 'next/image'
import {
  DoorKnockingRoutePayload,
  RoutePayloadAddress,
  RoutePayloadStop,
  RoutePayloadTarget,
} from '@goodparty_org/contracts'
import { skipInstruction, STATUS_LABELS } from '../native/statusPresentation'
import {
  ANSWER_COLUMN_KEYS,
  ANSWERED_BOXES,
  describeTarget,
  FOOTER_TAGLINE,
  lastContactLine,
  legTravelLine,
  MARK_INSTRUCTION,
  RECORDS_NOTICE,
  SUPPORT_BOXES,
  targetPhone,
  WALK_COLUMNS,
  walkSummary,
} from './walkFacts'
import './walkSheet.css'

// The design template's own eight columns and its own percentages, straight from
// `walkFacts` — the PDF resolves the same table against its own content width,
// so the two formats of one artifact cannot come out ruled differently.
//
// `table-layout: fixed` makes the widths binding rather than advisory, which is
// the point: the widest street name on a route must not be able to squeeze the
// column someone is writing in.
const COLUMN_COUNT = WALK_COLUMNS.length

// An outlined square with its label beneath it. The label is below rather than
// beside so a four-option column can be narrow: side-by-side labels are what
// forced the PDF's old `Y N ?` abbreviations, and an abbreviated option is one a
// transcriber has to guess the meaning of.
//
// The options are always the form's own, assembled in `walkFacts` and never a
// list written out here. Paper is transcribed back into `RecordKnockForm`, so a
// box this sheet offers that the form has no value for is an answer the
// canvasser cannot file.
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
      {/* The resident's own number, not the household's — two people behind one
          door have two records. It prints for every row, like the age and the
          address beside it, including a row whose answer columns carry a skip:
          the instruction is about knocking a door and the phone is the column
          that says what else there is. Empty rather than a dash when the file
          has none, for the reason the age cell is. */}
      <td className="ws-phone">{targetPhone(target) ?? ''}</td>
      {/* ADR 0007 and 0008. Turf evaluation keeps flagged people off new lists,
          but it cannot reach a route already frozen — and paper freezes again
          the moment it prints. The row stays so the sheet still matches the
          app's stop numbering; the boxes go, because there is nothing to ask.
          Checked before `recorded`: a flagged resident is not to be knocked
          whatever was logged there before. */}
      {skip !== null ? (
        <td className="ws-instruction" colSpan={ANSWER_COLUMN_KEYS.length}>
          {skip}
        </td>
      ) : recorded ? (
        <td className="ws-logged" colSpan={ANSWER_COLUMN_KEYS.length}>
          Already logged: {STATUS_LABELS[target.knockStatus]}
        </td>
      ) : (
        <>
          {/* The app's first question, whole and in its order. */}
          <td>
            <MarkBoxes options={ANSWERED_BOXES} />
          </td>
          {/* Support, with the one engagement answer a canvasser still has to be
              able to write down in front of it — paper cannot branch the way the
              app's walkthrough does, so the ending and the answer share a
              column. Assembled in `walkFacts` from the form's own constants. */}
          <td>
            <MarkBoxes options={SUPPORT_BOXES} />
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
      travel: legTravelLine(stop),
      alsoHere: others.length > 0 ? `Also here: ${others.join(', ')}` : null,
    }))
  })
}

// Two things and nothing else, as the template rules it: the horizontal logo at
// 22px on the left, the tagline in italics on the right. No rule above it, and
// no page counter — see `SheetHeader` for why the counter left rather than moved.
//
// The logo is the brand system's own lockup — heart plus the `GoodParty.org`
// wordmark — rather than the SVG the template ships, and it is the same one
// `pdf/GoodPartyLogo.tsx` traces, so the two paper surfaces are signed
// identically. `black-logo.svg` is the other horizontal mark in `public/images`
// and is a different lockup.
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
    <span className="ws-tagline">{FOOTER_TAGLINE}</span>
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
      {/* Two blanks, exactly as the template rules them, and deliberately no
          printed date: this renders in Node, whose clock is UTC, so an evening
          print anywhere in the US would be stamped tomorrow — and formatting it
          as UTC only makes the wrong date a consistent one. The canvasser dates
          the sheet, which is both accurate and what people already do with
          paper.

          The `Page ____ of ____` blank that used to sit beside them is gone
          rather than moved. It was there because the earlier handoff asked for
          `counter(page) of counter(pages)` and no browser resolves that outside
          an `@page` margin box, so a blank was the honest form of a number this
          surface cannot compute. The template asks for no counter at all, on
          either surface, so there is nothing left to stand in for — and a print
          dialog numbers the pages itself. */}
      <p className="ws-meta">
        <span>
          Canvasser <b>____________________</b>
        </span>
        <span>
          Date <b>____ / ____ / ______</b>
        </span>
      </p>
    </div>
    {/* One sentence, which is all the template's legend carries. The notice
        about re-keying moved to the screen-only preamble below — see
        `RECORDS_NOTICE`. */}
    <p className="ws-legend">{MARK_INSTRUCTION}</p>
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
          for the same grid as a file — easier to hand a volunteer.
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
            {WALK_COLUMNS.map(({ key, width }) => (
              <col key={key} style={{ width: `${width}%` }} />
            ))}
          </colgroup>
          {/* The template's header and legend repeat on every printed page. Its
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
              <td className="ws-banner" colSpan={COLUMN_COUNT}>
                <SheetHeader
                  turfName={turfName}
                  stops={stops}
                  payload={payload}
                />
              </td>
            </tr>
            <tr className="ws-cols">
              {WALK_COLUMNS.map(({ key, label }) => (
                <th key={key} scope="col">
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
              <td colSpan={COLUMN_COUNT}>
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
