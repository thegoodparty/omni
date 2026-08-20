import { Fragment } from 'react'
import {
  Document,
  Page,
  StyleSheet,
  Text,
  View,
  renderToBuffer,
} from '@react-pdf/renderer'
import type { DoorKnockingRoutePayload } from '@goodparty_org/contracts'
import { SUPPORT_OPTIONS, WILL_VOTE_OPTIONS } from '../../native/knockQuestions'
import { walkSummary } from '../walkFacts'
import { GoodPartyLogo } from './GoodPartyLogo'
import { walkListRows, type WalkListRow } from './walkListRows'

// Landscape letter, in points. Seven columns of writing space need the long
// edge; the printable page is portrait because it stacks a form per person
// instead of ruling them into a grid.
const CONTENT_WIDTH = 792 - 24 * 2

const COLUMN = {
  seq: 24,
  address: 170,
  resident: 150,
  answered: 74,
  supports: 86,
  willVote: 86,
} as const

const NOTES_WIDTH =
  CONTENT_WIDTH -
  (COLUMN.seq +
    COLUMN.address +
    COLUMN.resident +
    COLUMN.answered +
    COLUMN.supports +
    COLUMN.willVote)

const GRID = '#5c5c5c'
const MUTED = '#4a4a4a'

const styles = StyleSheet.create({
  page: {
    paddingTop: 22,
    paddingBottom: 40,
    paddingHorizontal: 24,
    fontSize: 8,
    color: '#000000',
  },
  title: { fontSize: 15, fontFamily: 'Helvetica-Bold' },
  summary: { fontSize: 9, marginTop: 2 },
  headNote: { flexDirection: 'row', alignItems: 'flex-end', marginTop: 4 },
  headNoteText: { flex: 1, fontSize: 7.5, color: MUTED, paddingRight: 8 },
  dateLabel: { fontSize: 7.5, fontFamily: 'Helvetica-Bold' },
  dateRule: {
    width: 70,
    marginLeft: 4,
    borderBottomWidth: 0.5,
    borderBottomColor: GRID,
  },

  headerRow: { flexDirection: 'row', marginTop: 8 },
  headerCell: {
    paddingVertical: 3,
    paddingHorizontal: 3,
    fontSize: 7.5,
    fontFamily: 'Helvetica-Bold',
    borderTopWidth: 0.5,
    borderBottomWidth: 0.5,
    borderLeftWidth: 0.5,
    borderColor: GRID,
  },

  row: { flexDirection: 'row' },
  cell: {
    paddingVertical: 3,
    paddingHorizontal: 3,
    borderLeftWidth: 0.5,
    borderColor: GRID,
  },
  cellRule: { borderTopWidth: 0.5, borderTopColor: GRID },
  lastCell: { borderRightWidth: 0.5, borderRightColor: GRID },
  gridBottom: { borderTopWidth: 0.5, borderTopColor: GRID },

  seqText: { fontSize: 9, fontFamily: 'Helvetica-Bold' },
  addressText: { fontSize: 8 },
  residentText: { fontSize: 8.5, fontFamily: 'Helvetica-Bold' },
  metaText: { fontSize: 6.5, color: MUTED, marginTop: 1 },
  instruction: { fontSize: 7, fontFamily: 'Helvetica-Bold' },
  logged: { fontSize: 7, color: MUTED },

  ticks: { flexDirection: 'row', alignItems: 'center', paddingTop: 1 },
  // Outlined, never filled: printers drop background colors by default, so
  // every mark on this page has to be a border or a glyph.
  //
  // Box and label are siblings rather than a wrapped pair. Every flex node
  // here is laid out by yoga, and the answer columns are most of the nodes on
  // the page — a 150-stop route pays for this per row.
  tickBox: {
    width: 7,
    height: 7,
    marginRight: 2,
    borderWidth: 0.5,
    borderColor: '#000000',
  },
  tickLabel: { fontSize: 7, marginRight: 6 },

  notes: {
    flexGrow: 1,
    minHeight: 56,
    marginTop: 8,
    padding: 4,
    borderWidth: 0.5,
    borderColor: GRID,
  },
  notesLabel: { fontSize: 7.5, fontFamily: 'Helvetica-Bold' },

  empty: { marginTop: 10, fontSize: 9 },

  footer: {
    position: 'absolute',
    bottom: 14,
    left: 24,
    right: 24,
    flexDirection: 'row',
    alignItems: 'center',
    paddingTop: 5,
    borderTopWidth: 0.5,
    borderTopColor: GRID,
  },
  tagline: { flex: 1, marginLeft: 6, fontSize: 7, color: MUTED },
  pageNumber: { fontSize: 7, color: MUTED },
})

// The grid has one narrow column per question, so the app's five-way outcome
// can't be pre-printed in it. `Answered? Y / N` is the split that fits, and it
// is the split that matters at the door; a canvasser who needs to say *why* a
// door didn't answer writes it in Notes, and whoever transcribes picks the
// outcome in the app. The printable page keeps the full five options — it has
// a form per person and the room to spend on them.
const ANSWERED_TICKS = ['Y', 'N']

// Support and will-vote are three-way in the app and three-way here, so these
// are generated from the same constants `RecordKnockForm` renders rather than
// typed out: a fourth option added there has to show up on the paper someone
// transcribes back into it.
const ABBREVIATION: Record<string, string> = { Yes: 'Y', No: 'N', Unsure: '?' }

const ticksFor = (options: Array<[string, string]>): string[] =>
  options.map(([, label]) => ABBREVIATION[label] ?? label)

const TickBoxes = ({ labels }: { labels: string[] }) => (
  <View style={styles.ticks}>
    {labels.map((label) => (
      <Fragment key={label}>
        <View style={styles.tickBox} />
        <Text style={styles.tickLabel}>{label}</Text>
      </Fragment>
    ))}
  </View>
)

const AnswerCells = ({ row }: { row: WalkListRow }) => {
  // A flagged or already-logged door gets the instruction across all three
  // answer columns instead of boxes: there is nothing to ask, and a blank form
  // is how a door gets knocked twice or a recorded answer overwritten.
  if (row.answer.kind !== 'form') {
    return (
      <View
        style={[
          styles.cell,
          styles.cellRule,
          {
            width: COLUMN.answered + COLUMN.supports + COLUMN.willVote,
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
      <View style={[styles.cell, styles.cellRule, { width: COLUMN.answered }]}>
        <TickBoxes labels={ANSWERED_TICKS} />
      </View>
      <View style={[styles.cell, styles.cellRule, { width: COLUMN.supports }]}>
        <TickBoxes labels={ticksFor(SUPPORT_OPTIONS)} />
      </View>
      <View style={[styles.cell, styles.cellRule, { width: COLUMN.willVote }]}>
        <TickBoxes labels={ticksFor(WILL_VOTE_OPTIONS)} />
      </View>
    </>
  )
}

const ResidentRow = ({ row }: { row: WalkListRow }) => (
  <View
    style={styles.row}
    wrap={false}
    // A household is allowed to break across pages rather than leave a hole at
    // the foot of one, but its first row shouldn't land alone at the bottom
    // with the rest overleaf — that is the one split that reads as a bug.
    minPresenceAhead={row.firstInHousehold ? 34 : 0}
  >
    <View
      style={[
        styles.cell,
        { width: COLUMN.seq },
        row.firstInStop ? styles.cellRule : {},
      ]}
    >
      {row.firstInStop && <Text style={styles.seqText}>{row.seq}</Text>}
    </View>
    <View
      style={[
        styles.cell,
        { width: COLUMN.address },
        row.firstInHousehold ? styles.cellRule : {},
      ]}
    >
      {row.firstInHousehold && (
        <>
          <Text style={styles.addressText}>{row.address}</Text>
          {row.otherResidents.length > 0 && (
            <Text style={styles.metaText}>
              Also here: {row.otherResidents.join(', ')}
            </Text>
          )}
        </>
      )}
    </View>
    <View style={[styles.cell, styles.cellRule, { width: COLUMN.resident }]}>
      <Text style={styles.residentText}>{row.name}</Text>
      {row.meta !== '' && <Text style={styles.metaText}>{row.meta}</Text>}
      {/* ENG-10876. Under the resident because it is a fact about them, not
          about the answer columns — those are for writing in, and this row's
          may already be a blank form for a door that was answered before. One
          Text node, and only for a resident with history, because node count
          per row is the lever on a 150-stop route's layout cost. */}
      {row.lastContact !== null && (
        <Text style={styles.metaText}>{row.lastContact}</Text>
      )}
    </View>
    <AnswerCells row={row} />
    <View
      style={[
        styles.cell,
        styles.cellRule,
        styles.lastCell,
        { width: NOTES_WIDTH },
      ]}
    />
  </View>
)

const HEADINGS: Array<[string, number]> = [
  ['#', COLUMN.seq],
  ['Address', COLUMN.address],
  ['Resident', COLUMN.resident],
  ['Answered?', COLUMN.answered],
  ['Supports?', COLUMN.supports],
  ['Will vote?', COLUMN.willVote],
  ['Notes', NOTES_WIDTH],
]

// `fixed` repeats this at the top of every page, so page four is still a table
// and not seven unlabelled columns of handwriting.
const HeaderRow = () => (
  <View style={styles.headerRow} fixed>
    {HEADINGS.map(([label, width], index) => (
      <Text
        key={label}
        style={[
          styles.headerCell,
          { width },
          index === HEADINGS.length - 1 ? styles.lastCell : {},
        ]}
      >
        {label}
      </Text>
    ))}
  </View>
)

const Footer = () => (
  <View style={styles.footer} fixed>
    <GoodPartyLogo height={11} />
    <Text style={styles.tagline}>Empowering people to run, win, and serve</Text>
    <Text
      style={styles.pageNumber}
      render={({
        pageNumber,
        totalPages,
      }: {
        pageNumber: number
        totalPages: number
      }) => `Page ${pageNumber} of ${totalPages}`}
    />
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
        <View>
          <Text style={styles.title}>{turfName}</Text>
          <Text style={styles.summary}>
            {walkSummary(payload.stops, payload.route)}
          </Text>
          {/* Deliberately no printed date. This renders in Node, whose clock is
              UTC, so an evening download anywhere in the US would be stamped
              tomorrow — and formatting it as UTC only makes the wrong date a
              consistent one. The canvasser dates the sheet. */}
          <View style={styles.headNote}>
            <Text style={styles.headNoteText}>
              Answers already logged in the app are printed below. Log these
              doors in the app when you&rsquo;re back online — nothing written
              here reaches your voter records on its own.
            </Text>
            <Text style={styles.dateLabel}>Date walked</Text>
            <View style={styles.dateRule} />
          </View>
        </View>

        {rows.length === 0 ? (
          <Text style={styles.empty}>This route has no stops.</Text>
        ) : (
          <>
            <HeaderRow />
            {rows.map((row) => (
              <ResidentRow key={row.key} row={row} />
            ))}
            <View style={styles.gridBottom} />
          </>
        )}

        <View style={styles.notes}>
          <Text style={styles.notesLabel}>Additional notes</Text>
        </View>

        <Footer />
      </Page>
    </Document>
  )
}

export const renderWalkListPdf = (props: WalkListPdfProps): Promise<Buffer> =>
  renderToBuffer(<WalkListPdf {...props} />)
