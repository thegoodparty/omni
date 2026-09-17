import {
  Document,
  Page,
  StyleSheet,
  Text,
  View,
  renderToBuffer,
} from '@react-pdf/renderer'
import type { DoorKnockingRoutePayload } from '@goodparty_org/contracts'
import {
  ANSWERED_BOXES,
  FOOTER_TAGLINE,
  MARK_INSTRUCTION,
  answerBoxes,
  walkColumns,
  WALK_COLUMNS,
  walkSummary,
  type WalkColumnKey,
} from '../walkFacts'
import { GoodPartyLogo } from './GoodPartyLogo'
import { walkListRows, type WalkListRow } from './walkListRows'

// The design template is written in CSS pixels and this document is measured in
// PostScript points. One conversion, in one place, so a value here can be read
// straight against the template: its 11px name is `px(11)`, not 8.25.
const px = (value: number): number => value * 0.75

// Landscape letter, in points. Eight columns of writing space need the long
// edge, and the margin is the template's own half inch.
const MARGIN = px(48)
const CONTENT_WIDTH = 792 - MARGIN * 2

// The template's own column percentages, resolved to points once at module load
// — a fixed grid is what stops the widest street name on a route from squeezing
// the column someone is writing in.
//
// There are no departures to justify any more. The two grids used to be sized
// independently, each arguing its way out of the percentages because one offered
// five outcomes and the other two; the template rules two questions with three
// and four boxes, which both surfaces can hold at the same widths. So the table
// is `walkFacts`' and this file only converts the unit.
const share = (percent: number): number => (CONTENT_WIDTH * percent) / 100

const COLUMN = Object.fromEntries(
  WALK_COLUMNS.map(({ key, width }) => [key, share(width)]),
) as Record<WalkColumnKey, number>

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
    paddingBottom: MARGIN + px(30),
    paddingHorizontal: MARGIN,
    fontSize: px(11),
    color: FOREGROUND,
  },

  header: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    paddingBottom: px(12),
  },
  title: { fontSize: px(22), fontFamily: 'Helvetica-Bold' },
  desc: { fontSize: px(12), color: MUTED, marginTop: px(4) },
  metaRow: { flexDirection: 'row' },
  meta: { fontSize: px(11), color: MUTED, marginLeft: px(20) },
  // The rule a canvasser writes on: foreground, and the same weight as the word
  // in front of it. It is a blank to be filled in, not a value already stated.
  metaValue: { fontSize: px(11), color: FOREGROUND },
  legend: { fontSize: px(10), color: MUTED, marginBottom: px(10) },

  // Column heads. Uppercase and tracked, and the only rule on the page heavier
  // than the hairline the grid is ruled with.
  headRow: {
    flexDirection: 'row',
    borderBottomWidth: px(1),
    borderBottomColor: FOREGROUND,
    paddingBottom: px(7),
  },
  headCell: {
    paddingHorizontal: px(6),
    fontSize: px(8),
    fontFamily: 'Helvetica-Bold',
    letterSpacing: px(0.48),
    color: MUTED,
    textTransform: 'uppercase',
  },

  // No vertical rules anywhere. The template rules the grid horizontally only,
  // and the columns are legible because they are fixed and aligned — which is
  // also seven fewer borders per row for yoga to lay out.
  row: { flexDirection: 'row', alignItems: 'center' },
  // The household boundary, so a shared front door reads as one door however
  // many people answer it. Hairline, like every rule below the column heads.
  household: { borderTopWidth: px(0.5), borderTopColor: FOREGROUND },
  // A second or third person behind the same door.
  mate: {
    borderTopWidth: px(1),
    borderTopColor: RULE,
    borderTopStyle: 'dotted',
  },
  cell: { paddingVertical: px(4), paddingHorizontal: px(6) },
  // The support column. There are no vertical rules on this grid, so the gap
  // between two runs of boxes is the only thing saying where one question ends
  // and the next begins — at the 6px body padding it is narrower than the gap
  // between two boxes inside one question.
  supportCell: { paddingLeft: px(34) },
  // The two outer columns run to the page's own margin rather than carrying a
  // gutter inside it.
  firstCell: { paddingLeft: 0 },
  lastCell: { paddingRight: 0 },

  seqText: { fontSize: px(9), color: MUTED },
  nameText: { fontSize: px(11), fontFamily: 'Helvetica-Bold' },
  mateNameText: { fontSize: px(11) },
  ageText: { fontSize: px(9), color: MUTED },
  addressText: { fontSize: px(9), color: MUTED },
  phoneText: { fontSize: px(9), color: MUTED },
  // A step below the 9px body numerics: these lines are the ones that decide how
  // tall a row is, and the route pays for every one of them sixteen pages over.
  subText: { fontSize: px(8), color: MUTED, marginTop: px(2) },
  instruction: { fontSize: px(9), fontFamily: 'Helvetica-Bold' },
  logged: { fontSize: px(9), color: MUTED },

  // Mark boxes. Outlined and never filled: printers drop background colours by
  // default, so every mark on this page is a border or a glyph. The label sits
  // beneath its box, which is what lets a four-option column spell "Unsure"
  // instead of abbreviating it to `?`.
  boxes: { flexDirection: 'row', alignItems: 'flex-start' },
  // The options under one question are alternatives to each other, so they share
  // the cell evenly — the template lays them out on `grid-auto-columns: 1fr`.
  //
  // Here that is `flexGrow: 1` over the **content** basis rather than over
  // `flexBasis: 0`, and the difference is not cosmetic. At a zero basis every
  // option gets exactly a third of the cell, "INACCESSIBLE" does not fit a
  // third, and @react-pdf breaks a word it cannot fit with a **hyphen** — the
  // label came out as "INACCESSI-BLE", a hyphen a canvasser has to decide is not
  // part of the answer. The template says `hyphens: none` for the same reason,
  // and the only way to say that to this renderer is
  // `Font.registerHyphenationCallback`, which is process-global and would reach
  // the campaign-plan and opponent-brief documents too.
  //
  // Growing from content instead gives every option its own width plus an equal
  // share of what is left, which is the same even spread wherever the labels fit
  // — the three widest measure about 102pt against the 122pt the 17% column
  // gives them — and degrades by crowding rather than by breaking a word.
  option: { flexGrow: 1, alignItems: 'center' },
  box: {
    width: px(12),
    height: px(12),
    borderWidth: px(1.5),
    borderColor: FOREGROUND,
    borderRadius: px(3),
  },
  optionLabel: {
    fontSize: px(7),
    fontFamily: 'Helvetica-Bold',
    color: MUTED,
    marginTop: px(4),
    textAlign: 'center',
    textTransform: 'uppercase',
  },

  gridBottom: { borderTopWidth: px(0.5), borderTopColor: FOREGROUND },
  empty: { marginTop: px(12), fontSize: px(11) },

  // Logo left, tagline right, and no rule above it: the grid's own last row is
  // closed by a hairline, and a second line under it reads as an empty row.
  footer: {
    position: 'absolute',
    bottom: MARGIN,
    left: MARGIN,
    right: MARGIN,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  tagline: {
    fontSize: px(11),
    fontFamily: 'Helvetica-Oblique',
    color: MUTED,
  },
})

// Always the form's own options, assembled in `walkFacts` and never a list typed
// out here. Paper is transcribed back into `RecordKnockForm`, so a box this grid
// offers that the form has no value for is an answer the canvasser cannot file
// — and the printable page reads the same two lists, so the two formats of one
// artifact cannot ask different questions.
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

const AnswerCells = ({
  row,
  isServe,
}: {
  row: WalkListRow
  isServe: boolean
}) => {
  // A flagged or already-logged door gets the instruction across all three
  // answer columns instead of boxes: there is nothing to ask, and a blank form
  // is how a door gets knocked twice or a recorded answer overwritten.
  if (row.answer.kind !== 'form') {
    return (
      <View
        style={[
          styles.cell,
          styles.lastCell,
          { width: COLUMN.answered + COLUMN.support + COLUMN.notes },
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
      {/* The app's first question, whole and in its order — the grid used to
          pre-print two of five outcomes at 8% of the page and label them Yes /
          No, which is the compression the template's 17% buys out. */}
      <View style={[styles.cell, { width: COLUMN.answered }]}>
        <MarkBoxes options={ANSWERED_BOXES} />
      </View>
      {/* The surface's own last question, with the one engagement answer a
          canvasser still has to be able to write down in front of it: paper
          cannot branch the way the app's walkthrough does, so the ending and
          the answer share a column. */}
      <View
        style={[styles.cell, styles.supportCell, { width: COLUMN.support }]}
      >
        <MarkBoxes options={answerBoxes(isServe)} />
      </View>
      {/* Empty and stays empty: this is the column the canvasser writes in. */}
      <View style={[styles.cell, styles.lastCell, { width: COLUMN.notes }]} />
    </>
  )
}

const ResidentRow = ({
  row,
  isServe,
}: {
  row: WalkListRow
  isServe: boolean
}) => (
  <View
    style={[styles.row, row.firstInHousehold ? styles.household : styles.mate]}
    wrap={false}
    // A household is allowed to break across pages rather than leave a hole at
    // the foot of one, but its first row shouldn't land alone at the bottom with
    // the rest overleaf — that is the one split that reads as a bug.
    minPresenceAhead={row.firstInHousehold ? px(45) : 0}
  >
    <View style={[styles.cell, styles.firstCell, { width: COLUMN.seq }]}>
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
          {/* Already merged to the stop's first row by the row model, and null on
              a first stop, so this is one more Text node per stop rather than per
              resident — the difference between ~150 nodes and ~250 on a capped
              route. */}
          {row.travel !== null && (
            <Text style={styles.subText}>{row.travel}</Text>
          )}
          {row.otherResidents.length > 0 && (
            <Text style={styles.subText}>
              Also here: {row.otherResidents.join(', ')}
            </Text>
          )}
        </>
      )}
    </View>
    {/* The resident's own number, not the household's. It prints on every row,
        like the age and the address beside it, including a row whose answer
        columns carry a skip instruction — that instruction is about knocking a
        door, and this is the column that says what else there is. */}
    <View style={[styles.cell, { width: COLUMN.phone }]}>
      {row.phone !== null && <Text style={styles.phoneText}>{row.phone}</Text>}
    </View>
    <AnswerCells row={row} isServe={isServe} />
  </View>
)

// `fixed` repeats this at the top of every page, so page four is still a table
// and not eight unlabelled columns of handwriting.
const HeadRow = ({ isServe }: { isServe: boolean }) => (
  <View style={styles.headRow} fixed>
    {walkColumns(isServe).map(({ key, label }, index) => (
      <Text
        key={key}
        style={[
          styles.headCell,
          index === 0 ? styles.firstCell : {},
          key === 'support' ? styles.supportCell : {},
          index === WALK_COLUMNS.length - 1 ? styles.lastCell : {},
          { width: COLUMN[key] },
        ]}
      >
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
    {/* Two blanks and nothing else, as the template rules them. Deliberately no
        printed date: this renders in Node, whose clock is UTC, so an evening
        download anywhere in the US would be stamped tomorrow — and formatting it
        as UTC only makes the wrong date a consistent one. The canvasser dates
        the sheet.

        The `Page N of M` counter that used to close this row is gone rather than
        moved. This renderer can answer it — it lays the whole document out
        before it writes any of it — and the printable page could only print a
        blank, which is why the two surfaces read differently here at all. The
        template asks for no counter on either, so the asymmetry goes with it. */}
    <View style={styles.metaRow}>
      <Text style={styles.meta}>
        Canvasser <Text style={styles.metaValue}>____________________</Text>
      </Text>
      <Text style={styles.meta}>
        Date <Text style={styles.metaValue}>____ / ____ / ______</Text>
      </Text>
    </View>
  </View>
)

// Logo left, tagline right, and nothing else. The tagline is quoted from
// `walkFacts` rather than typed here, so the two paper surfaces cannot be signed
// differently.
const Footer = () => (
  <View style={styles.footer} fixed>
    <GoodPartyLogo height={px(22)} />
    <Text style={styles.tagline}>{FOOTER_TAGLINE}</Text>
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
  // Absent reads as Win, for the reason the printable page's does.
  const isServe = Boolean(payload.isServe)
  const rows = walkListRows(payload.stops, isServe)

  return (
    <Document title={turfName} author="GoodParty.org" subject="Walk list">
      <Page size="LETTER" orientation="landscape" style={styles.page}>
        <Header turfName={turfName} payload={payload} />
        {/* One sentence, which is all the template's legend carries. */}
        <Text style={styles.legend} fixed>
          {MARK_INSTRUCTION}
        </Text>

        {rows.length === 0 ? (
          <Text style={styles.empty}>This route has no stops.</Text>
        ) : (
          <>
            <HeadRow isServe={isServe} />
            {rows.map((row) => (
              <ResidentRow key={row.key} row={row} isServe={isServe} />
            ))}
            <View style={styles.gridBottom} />
          </>
        )}

        {/* No spare notes block below the grid. The design spends a share of
            every row on Notes and gives the foot of the page to the footer; the
            box this file used to carry sat between them and grew to fill
            whatever the last page had left. */}
        <Footer />
      </Page>
    </Document>
  )
}

export const renderWalkListPdf = (props: WalkListPdfProps): Promise<Buffer> =>
  renderToBuffer(<WalkListPdf {...props} />)
