import {
  Document,
  Page,
  StyleSheet,
  Text,
  View,
  renderToBuffer,
} from '@react-pdf/renderer'
import type {
  DoorKnockingRoutePayload,
  DoorKnockOutcome,
} from '@goodparty_org/contracts'
import { SUPPORT_OPTIONS, WILL_VOTE_OPTIONS } from '../../native/knockQuestions'
import {
  MARK_INSTRUCTION,
  RECORDS_NOTICE,
  WALK_COLUMNS,
  walkSummary,
} from '../walkFacts'
import { GoodPartyLogo } from './GoodPartyLogo'
import { walkListRows, type WalkListRow } from './walkListRows'

// The handoff is written in CSS pixels and this document is measured in PostScript
// points. One conversion, in one place, so a value here can be read straight
// against the spec: the 10.5px name is `px(10.5)`, not 7.875.
const px = (value: number): number => value * 0.75

// Landscape letter, in points. Eight columns of writing space need the long
// edge, and the margin is the handoff's own half inch.
const MARGIN = px(48)
const CONTENT_WIDTH = 792 - MARGIN * 2

// The handoff's own column percentages where the column means the same thing on
// both surfaces — `Age 4`, and `Address` within a point of its 16 — resolved to
// points once, at module load, because a fixed grid is what stops the widest
// street name on a route from squeezing the column someone is writing in.
//
// The departures follow from the columns this grid actually has, plus one thing
// the handoff's own fixture could not have hit:
//
//   - `Phone 11` is not here, and its share funds `Will vote`, the column the
//     handoff drops and the app's form still asks.
//   - `Answered` is 8 rather than 12, because this grid pre-prints two of the
//     five outcomes where the printable page has room for all of them, and
//     `Support` is 11 rather than 16 because ours is three-way against the
//     handoff's four. Both savings go to `Notes`, at 26 the column a canvasser
//     actually writes in.
//   - `#` is 3 rather than 2: the handoff renders 1 to 40 rows, a route here is
//     capped at 150 stops, and "150" does not fit 2% of a landscape page.
//   - `Name` is 22 rather than 18, and this one is measured. It carries the
//     last-contact line the handoff has no row for, and at 18 that line wrapped
//     on roughly a third of the rows: 22 pages at the 150-stop cap against 19 at
//     22%. The three pages are worth more than the four points.
const share = (percent: number): number => (CONTENT_WIDTH * percent) / 100

const COLUMN = {
  seq: share(3),
  name: share(22),
  age: share(4),
  address: share(15),
  answered: share(8),
  support: share(11),
  willVote: share(11),
  notes: share(26),
} as const

// Traced from the design system rather than invented: `--color-foreground`,
// `--color-muted-foreground` and `--color-border` as they resolve in the light
// theme, which is the only theme paper has. Literals because `@react-pdf` has no
// cascade to read a custom property from — the printable page reads the tokens
// themselves, and these three values are what it resolves them to.
const FOREGROUND = '#0d1117'
const MUTED = '#5b6472'
const RULE = '#d8dce3'

const styles = StyleSheet.create({
  page: {
    paddingTop: MARGIN,
    // Room for the fixed footer, which sits outside the flow.
    paddingBottom: MARGIN + px(34),
    paddingHorizontal: MARGIN,
    fontSize: px(10.5),
    color: FOREGROUND,
  },

  header: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    paddingBottom: px(12),
  },
  title: { fontSize: px(20), fontFamily: 'Helvetica-Bold' },
  desc: { fontSize: px(12), color: MUTED, marginTop: px(4) },
  metaRow: { flexDirection: 'row' },
  meta: { fontSize: px(12), color: MUTED, marginLeft: px(24) },
  metaValue: { fontSize: px(12), fontFamily: 'Helvetica-Bold' },
  legend: { fontSize: px(11), color: MUTED, marginBottom: px(12) },

  // Column heads. Uppercase and tracked, per the handoff, and the only rule on
  // the page heavier than hairline.
  headRow: {
    flexDirection: 'row',
    borderBottomWidth: px(1),
    borderBottomColor: FOREGROUND,
    paddingBottom: px(6),
  },
  headCell: {
    paddingHorizontal: px(4),
    fontSize: px(8.5),
    fontFamily: 'Helvetica-Bold',
    letterSpacing: px(0.34),
    color: MUTED,
    textTransform: 'uppercase',
  },

  // No vertical rules anywhere. The handoff rules the grid horizontally only,
  // and the columns are legible because they are fixed and aligned — which is
  // also six fewer borders per row for yoga to lay out.
  row: { flexDirection: 'row', alignItems: 'center' },
  // The heavier rule is a household boundary, so a shared front door reads as
  // one door however many people answer it.
  household: { borderTopWidth: px(1), borderTopColor: FOREGROUND },
  // A second or third person behind the same door.
  mate: {
    borderTopWidth: px(1),
    borderTopColor: RULE,
    borderTopStyle: 'dotted',
  },
  cell: { paddingVertical: px(5), paddingHorizontal: px(4) },

  seqText: {
    fontSize: px(9.5),
    color: MUTED,
  },
  nameText: { fontSize: px(10.5), fontFamily: 'Helvetica-Bold' },
  mateNameText: { fontSize: px(10.5) },
  ageText: { fontSize: px(9.5), color: MUTED },
  addressText: { fontSize: px(9.5) },
  // A step below the handoff's 9.5px numeric size, at the 8.5px it gives column
  // heads: these lines are the ones that decide how tall a row is, and the
  // route pays for every one of them sixteen pages over.
  subText: { fontSize: px(8.5), color: MUTED, marginTop: px(2) },
  instruction: { fontSize: px(9.5), fontFamily: 'Helvetica-Bold' },
  logged: { fontSize: px(9.5), color: MUTED },

  // Mark boxes. Outlined and never filled: printers drop background colours by
  // default, so every mark on this page is a border or a glyph. The label sits
  // beneath its box, per the handoff, which is what lets a three-option column
  // spell "Unsure" instead of abbreviating it to `?`.
  boxes: { flexDirection: 'row' },
  option: { alignItems: 'center', marginRight: px(8) },
  box: {
    width: px(12),
    height: px(12),
    borderWidth: px(1.5),
    borderColor: FOREGROUND,
    borderRadius: px(2),
  },
  optionLabel: {
    fontSize: px(7),
    fontFamily: 'Helvetica-Bold',
    color: MUTED,
    marginTop: px(3),
    textTransform: 'uppercase',
  },

  gridBottom: { borderTopWidth: px(1), borderTopColor: FOREGROUND },
  empty: { marginTop: px(12), fontSize: px(10.5) },

  footer: {
    position: 'absolute',
    bottom: MARGIN,
    left: MARGIN,
    right: MARGIN,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: px(20),
    borderTopWidth: px(1),
    borderTopColor: RULE,
  },
  tagline: { fontSize: px(12), fontFamily: 'Helvetica-Oblique' },
})

// Always the form's own options, never a list typed out here. Paper is
// transcribed back into that form, so a box this grid offers that the form does
// not is an answer the canvasser cannot file.
//
// This is also why the handoff's four-way Support (Strong / Lean / Undec / No)
// and its "Moved" outcome are not on this page: they contradict the Voter
// Outreach 2.0 canvas, which is this feature's source of truth and ticks `Yes /
// No / Unsure` for both follow-ups. "Strong" occurs once in the whole canvas, as
// one of four values of a voter's CRM *support attribute*, which is a field on a
// record rather than something anyone ticks at a door; "Lean" occurs nowhere.
// They are an error in the handoff, not a decision to reconcile. See the
// `### Paper` section of AGENTS.md.
const MarkBoxes = ({
  options,
}: {
  options: ReadonlyArray<readonly [string, string]>
}) => (
  <View style={styles.boxes}>
    {options.map(([value, label]) => (
      <View style={styles.option} key={value}>
        <View style={styles.box} />
        <Text style={styles.optionLabel}>{label}</Text>
      </View>
    ))}
  </View>
)

// The handoff's Yes / No, on the handoff's `Answered` column — the one place on
// this page the label is not `OUTCOME_OPTIONS`' own wording, because "Answered:
// Answered" is not a question anyone can read. The values are real outcomes, so
// a ticked box maps onto something the form accepts; the three this drops
// (inaccessible, refused, not a voter) are the ones a canvasser needs to write a
// reason beside anyway, and Notes is the next column.
//
// Two options, not the handoff's three: its third is "Moved", which is not a
// door outcome in this app or in the canvas — the only "Moved" in the canvas is
// the "Moved to archive" toast for a list. A resident who moved is
// `notAVoterReason`, a record flag, and `skipInstruction` already prints what it
// means in place of these boxes. The printable page has room for all five.
const ANSWERED_OPTIONS: ReadonlyArray<readonly [DoorKnockOutcome, string]> = [
  ['answered', 'Yes'],
  ['not_home', 'No'],
]

const AnswerCells = ({ row }: { row: WalkListRow }) => {
  // A flagged or already-logged door gets the instruction across all four
  // answer columns instead of boxes: there is nothing to ask, and a blank form
  // is how a door gets knocked twice or a recorded answer overwritten.
  if (row.answer.kind !== 'form') {
    return (
      <View
        style={[
          styles.cell,
          {
            width:
              COLUMN.answered + COLUMN.support + COLUMN.willVote + COLUMN.notes,
          },
        ]}
      >
        {row.answer.kind === 'skip' ? (
          <Text style={styles.instruction}>{row.answer.instruction}</Text>
        ) : (
          <Text style={styles.logged}>Already logged: {row.answer.label}</Text>
        )}
      </View>
    )
  }

  return (
    <>
      {/* Two options where the printable page offers five. This column is 8% of
          a landscape page and each option is a box with a word under it; the
          three outcomes it drops are the ones that need a reason written next to
          them anyway, and Notes is next to it. */}
      <View style={[styles.cell, { width: COLUMN.answered }]}>
        <MarkBoxes options={ANSWERED_OPTIONS} />
      </View>
      <View style={[styles.cell, { width: COLUMN.support }]}>
        <MarkBoxes options={SUPPORT_OPTIONS} />
      </View>
      {/* The handoff has no Will-vote column. Kept, because the app's form asks
          it and a sheet that cannot record an answer the form wants is a sheet
          that has to be walked twice. */}
      <View style={[styles.cell, { width: COLUMN.willVote }]}>
        <MarkBoxes options={WILL_VOTE_OPTIONS} />
      </View>
      {/* Empty and stays empty: this is the column the canvasser writes in. */}
      <View style={[styles.cell, { width: COLUMN.notes }]} />
    </>
  )
}

const ResidentRow = ({ row }: { row: WalkListRow }) => (
  <View
    style={[styles.row, row.firstInHousehold ? styles.household : styles.mate]}
    wrap={false}
    // A household is allowed to break across pages rather than leave a hole at
    // the foot of one, but its first row shouldn't land alone at the bottom with
    // the rest overleaf — that is the one split that reads as a bug.
    minPresenceAhead={row.firstInHousehold ? px(45) : 0}
  >
    <View style={[styles.cell, { width: COLUMN.seq }]}>
      {row.firstInStop && <Text style={styles.seqText}>{row.seq}</Text>}
    </View>
    <View style={[styles.cell, { width: COLUMN.name }]}>
      <Text
        style={row.firstInHousehold ? styles.nameText : styles.mateNameText}
      >
        {row.name}
      </Text>
      {row.meta !== '' && <Text style={styles.subText}>{row.meta}</Text>}
      {/* ENG-10876. Under the resident because it is a fact about them, not
          about the answer columns — those are for writing in, and this row's may
          already be a blank form for a door that was answered before. The
          handoff has no line for it; dropping it would regress a shipped fix.
          One Text node, and only for a resident with history, because node count
          per row is the lever on a 150-stop route's layout cost. */}
      {row.lastContact !== null && (
        <Text style={styles.subText}>{row.lastContact}</Text>
      )}
    </View>
    <View style={[styles.cell, { width: COLUMN.age }]}>
      {row.age !== null && <Text style={styles.ageText}>{row.age}</Text>}
    </View>
    <View style={[styles.cell, { width: COLUMN.address }]}>
      {row.firstInHousehold && (
        <>
          <Text style={styles.addressText}>{row.address}</Text>
          {row.otherResidents.length > 0 && (
            <Text style={styles.subText}>
              Also here: {row.otherResidents.join(', ')}
            </Text>
          )}
        </>
      )}
    </View>
    <AnswerCells row={row} />
  </View>
)

const HEADINGS: Array<[string, number]> = [
  [WALK_COLUMNS.seq, COLUMN.seq],
  [WALK_COLUMNS.name, COLUMN.name],
  [WALK_COLUMNS.age, COLUMN.age],
  [WALK_COLUMNS.address, COLUMN.address],
  [WALK_COLUMNS.answered, COLUMN.answered],
  [WALK_COLUMNS.support, COLUMN.support],
  [WALK_COLUMNS.willVote, COLUMN.willVote],
  [WALK_COLUMNS.notes, COLUMN.notes],
]

// `fixed` repeats this at the top of every page, so page four is still a table
// and not eight unlabelled columns of handwriting.
const HeadRow = () => (
  <View style={styles.headRow} fixed>
    {HEADINGS.map(([label, width]) => (
      <Text key={label} style={[styles.headCell, { width }]}>
        {label}
      </Text>
    ))}
  </View>
)

interface HeaderProps {
  turfName: string
  payload: DoorKnockingRoutePayload
}

// `fixed`, so the route names itself on every page. Sixteen sheets get separated
// and a page four that says only "Page 4 of 16" belongs to no turf.
const Header = ({ turfName, payload }: HeaderProps) => (
  <View style={styles.header} fixed>
    <View>
      <Text style={styles.title}>{turfName}</Text>
      {/* Stops, doors and people are three different numbers, and the printable
          page quotes the same sentence from the same helper — the app and the
          paper have reported different door counts for one route before. */}
      <Text style={styles.desc}>
        {walkSummary(payload.stops, payload.route)}
      </Text>
    </View>
    {/* Deliberately no printed date. This renders in Node, whose clock is UTC,
        so an evening download anywhere in the US would be stamped tomorrow —
        and formatting it as UTC only makes the wrong date a consistent one. The
        canvasser dates the sheet. */}
    <View style={styles.metaRow}>
      <Text style={styles.meta}>
        Canvasser <Text style={styles.metaValue}>______________________</Text>
      </Text>
      <Text style={styles.meta}>
        Date <Text style={styles.metaValue}>____ / ____ / ______</Text>
      </Text>
      {/* The page counter the handoff asks for, in the row it asks for it in,
          on the surface that can answer it: `totalPages` is known here because
          this renderer lays the whole document out before it writes any of it.
          The printable page prints blanks in this same slot — see
          `WalkSheet.tsx` for why no browser resolves `counter(pages)`. */}
      <Text
        style={styles.meta}
        render={({
          pageNumber,
          totalPages,
        }: {
          pageNumber: number
          totalPages: number
        }) => `Page ${pageNumber} of ${totalPages}`}
      />
    </View>
  </View>
)

const Footer = () => (
  <View style={styles.footer} fixed>
    <GoodPartyLogo height={px(22)} />
    {/* Logo left, tagline right, and nothing else — the page number lives in the
        header, where the handoff puts it. */}
    <Text style={styles.tagline}>Empowering people to run, win, and serve</Text>
  </View>
)

interface WalkListPdfProps {
  turfName: string
  payload: DoorKnockingRoutePayload
}

// The downloadable half of the v1 offline story: the same walk list as the
// printable page, ruled into a grid a canvasser fills in and someone else
// transcribes. Deliberately rendered on the server — see the route handler.
export const WalkListPdf = ({ turfName, payload }: WalkListPdfProps) => {
  const rows = walkListRows(payload.stops)

  return (
    <Document title={turfName} author="GoodParty.org" subject="Walk list">
      <Page size="LETTER" orientation="landscape" style={styles.page}>
        <Header turfName={turfName} payload={payload} />
        <Text style={styles.legend} fixed>
          {MARK_INSTRUCTION} {RECORDS_NOTICE}
        </Text>

        {rows.length === 0 ? (
          <Text style={styles.empty}>This route has no stops.</Text>
        ) : (
          <>
            <HeadRow />
            {rows.map((row) => (
              <ResidentRow key={row.key} row={row} />
            ))}
            <View style={styles.gridBottom} />
          </>
        )}

        {/* No spare notes block below the grid any more. The handoff spends a
            fifth of every row on Notes and gives the foot of the page to the
            footer; the box this file used to carry sat between them and grew to
            fill whatever the last page had left, which is space the design
            spends on the rows above it. */}
        <Footer />
      </Page>
    </Document>
  )
}

export const renderWalkListPdf = (props: WalkListPdfProps): Promise<Buffer> =>
  renderToBuffer(<WalkListPdf {...props} />)
