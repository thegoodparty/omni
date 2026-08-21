import { Fragment } from 'react'
import {
  Document,
  Page,
  StyleSheet,
  Text,
  View,
  renderToBuffer,
} from '@react-pdf/renderer'
import type {
  PhoneBankCallOutcome,
  SupportAnswer,
} from '@goodparty_org/contracts'
import { GoodPartyLogo } from 'app/dashboard/door-knocking/print/pdf/GoodPartyLogo'
import { type CallSheetAnswer, type CallSheetRow } from './callSheetRows'

// Landscape letter, same as the walk-list PDF this templates — ten columns of
// writing space need the long edge.
const CONTENT_WIDTH = 792 - 24 * 2

const COLUMN = {
  seq: 24,
  name: 150,
  phone: 92,
  answered: 46,
  noAnswer: 50,
  voicemail: 50,
  wrongNumber: 46,
  refused: 46,
  support: 92,
} as const

const OUTCOME_WIDTH =
  COLUMN.answered +
  COLUMN.noAnswer +
  COLUMN.voicemail +
  COLUMN.wrongNumber +
  COLUMN.refused

const NOTES_WIDTH =
  CONTENT_WIDTH -
  (COLUMN.seq + COLUMN.name + COLUMN.phone + OUTCOME_WIDTH + COLUMN.support)

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
  sheetLabel: { fontSize: 9, marginTop: 2, color: MUTED },

  script: {
    marginTop: 8,
    padding: 6,
    borderWidth: 0.5,
    borderColor: GRID,
  },
  scriptLabel: { fontSize: 7.5, fontFamily: 'Helvetica-Bold' },
  scriptText: { fontSize: 8, marginTop: 2 },

  disclaimer: { fontSize: 7.5, color: MUTED, marginTop: 6 },

  headerRow: { flexDirection: 'row', marginTop: 8 },
  headerCell: {
    paddingVertical: 3,
    paddingHorizontal: 3,
    fontSize: 7,
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
    borderTopWidth: 0.5,
    borderColor: GRID,
  },
  lastCell: { borderRightWidth: 0.5, borderRightColor: GRID },
  gridBottom: { borderTopWidth: 0.5, borderTopColor: GRID },

  seqText: { fontSize: 9, fontFamily: 'Helvetica-Bold' },
  nameLine: { fontSize: 8, marginBottom: 1 },
  phoneText: { fontSize: 8 },
  logged: { fontSize: 7, color: MUTED },
  instruction: { fontSize: 7, fontFamily: 'Helvetica-Bold' },

  ticks: { flexDirection: 'row', alignItems: 'center', marginBottom: 1 },
  // Outlined, never filled: printers drop background colors by default, so
  // every mark on this page has to be a border or a glyph.
  tickBox: {
    width: 7,
    height: 7,
    marginRight: 2,
    borderWidth: 0.5,
    borderColor: '#000000',
  },
  tickLabel: { fontSize: 7, marginRight: 6 },

  outcomeTick: { alignItems: 'center' },
  singleTick: {
    width: 8,
    height: 8,
    borderWidth: 0.5,
    borderColor: '#000000',
  },

  noteLine: {
    minHeight: 12,
    borderBottomWidth: 0.5,
    borderBottomColor: GRID,
    marginBottom: 1,
  },

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

const OUTCOME_ORDER: Array<[PhoneBankCallOutcome, number]> = [
  ['answered', COLUMN.answered],
  ['no_answer', COLUMN.noAnswer],
  ['voicemail', COLUMN.voicemail],
  ['wrong_number', COLUMN.wrongNumber],
  ['refused', COLUMN.refused],
]

// Support is three-way in the app (yes / unsure / no) and three-way here, in
// the header's own order — "Support Y U N" — so a canvasser transcribing a
// tick knows which one they meant.
const SUPPORT_TICKS: Array<[SupportAnswer, string]> = [
  ['supporter', 'Y'],
  ['unsure', 'U'],
  ['non_supporter', 'N'],
]

// A form row gets one outlined box per outcome column — mutually exclusive,
// so unlike the walk list's Y/N pairs there is nothing to label inside the
// box; the header already names the column. A logged or skipped row merges
// all five columns into one cell, the same shape as the walk list's
// `AnswerCells` for a door that isn't a blank form.
const OutcomeCells = ({ outcome }: { outcome: CallSheetAnswer }) => {
  if (outcome.kind !== 'form') {
    return (
      <View style={[styles.cell, { width: OUTCOME_WIDTH }]}>
        <Text
          style={outcome.kind === 'skip' ? styles.instruction : styles.logged}
        >
          {outcome.kind === 'skip'
            ? outcome.instruction
            : `Already called: ${outcome.label}`}
        </Text>
      </View>
    )
  }

  return (
    <>
      {OUTCOME_ORDER.map(([key, width]) => (
        <View key={key} style={[styles.cell, styles.outcomeTick, { width }]}>
          <View style={styles.singleTick} />
        </View>
      ))}
    </>
  )
}

const SupportLine = ({ support }: { support: CallSheetAnswer }) => {
  if (support.kind === 'skip') return <Text style={styles.logged}>—</Text>
  if (support.kind === 'logged') {
    return <Text style={styles.logged}>{support.label}</Text>
  }
  return (
    <View style={styles.ticks}>
      {SUPPORT_TICKS.map(([key, label]) => (
        <Fragment key={key}>
          <View style={styles.tickBox} />
          <Text style={styles.tickLabel}>{label}</Text>
        </Fragment>
      ))}
    </View>
  )
}

const CallRow = ({ row }: { row: CallSheetRow }) => (
  <View style={styles.row} wrap={false}>
    <View style={[styles.cell, { width: COLUMN.seq }]}>
      <Text style={styles.seqText}>{row.seq}</Text>
    </View>
    <View style={[styles.cell, { width: COLUMN.name }]}>
      {row.persons.map((person) => (
        <Text key={person.key} style={styles.nameLine}>
          {person.name}
        </Text>
      ))}
    </View>
    <View style={[styles.cell, { width: COLUMN.phone }]}>
      <Text style={styles.phoneText}>{row.phone}</Text>
    </View>
    <OutcomeCells outcome={row.outcome} />
    <View style={[styles.cell, { width: COLUMN.support }]}>
      {row.persons.map((person) => (
        <SupportLine key={person.key} support={person.support} />
      ))}
    </View>
    <View style={[styles.cell, styles.lastCell, { width: NOTES_WIDTH }]}>
      {row.persons.map((person) => (
        <View key={person.key} style={styles.noteLine} />
      ))}
    </View>
  </View>
)

const HEADINGS: Array<[string, number]> = [
  ['#', COLUMN.seq],
  ['Name(s)', COLUMN.name],
  ['Phone', COLUMN.phone],
  ['Answered', COLUMN.answered],
  ['No answer', COLUMN.noAnswer],
  ['Voicemail', COLUMN.voicemail],
  ['Wrong #', COLUMN.wrongNumber],
  ['Refused', COLUMN.refused],
  ['Support Y U N', COLUMN.support],
  ['Notes', NOTES_WIDTH],
]

// `fixed` repeats this at the top of every page, so a later page is still a
// table and not ten unlabelled columns of handwriting.
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

interface CallSheetPdfProps {
  listName: string
  script: string
  sheetIndex: number
  sheetCount: number
  rows: CallSheetRow[]
}

// The downloadable call sheet: the walk-list PDF's direct template, ruled
// into a grid a volunteer fills in and someone else transcribes. Rendered
// server-side for the same reason the walk list is — see the route handler.
export const CallSheetPdf = ({
  listName,
  script,
  sheetIndex,
  sheetCount,
  rows,
}: CallSheetPdfProps) => (
  <Document title={listName} author="GoodParty.org" subject="Call sheet">
    <Page size="LETTER" orientation="landscape" style={styles.page}>
      <View>
        <Text style={styles.title}>{listName}</Text>
        <Text style={styles.sheetLabel}>
          Sheet {sheetIndex} of {sheetCount}
        </Text>
        <View style={styles.script}>
          <Text style={styles.scriptLabel}>Script</Text>
          <Text style={styles.scriptText}>{script}</Text>
        </View>
        {/* Deliberately no printed date, for the same reason the walk list
            has none: this renders in Node, whose clock is UTC. */}
        <Text style={styles.disclaimer}>
          Answers already logged in the app are printed below. Log these in the
          app when you&rsquo;re back online — nothing written here reaches your
          voter records on its own.
        </Text>
      </View>

      {rows.length === 0 ? (
        <Text style={styles.empty}>This sheet has no calls.</Text>
      ) : (
        <>
          <HeaderRow />
          {rows.map((row) => (
            <CallRow key={row.key} row={row} />
          ))}
          <View style={styles.gridBottom} />
        </>
      )}

      <Footer />
    </Page>
  </Document>
)

export const renderCallSheetPdf = (props: CallSheetPdfProps): Promise<Buffer> =>
  renderToBuffer(<CallSheetPdf {...props} />)
