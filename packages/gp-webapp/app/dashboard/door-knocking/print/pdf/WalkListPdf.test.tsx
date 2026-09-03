// @vitest-environment node
//
// The PDF is rendered by the Node build of @react-pdf/renderer inside a route
// handler, so these tests render it the same way — in Node, through the same
// entry point — rather than asserting against a React tree that never becomes
// a file. A render costs a couple of seconds, so the fixtures that several
// assertions share are rendered once.
import { inflateSync } from 'node:zlib'
import { beforeAll, describe, expect, it } from 'vitest'
import type {
  RoutePayloadStop,
  RoutePayloadTarget,
} from '@goodparty_org/contracts'
import { doorKnock, payload, stop, target } from './walkListFixtures'
import { renderWalkListPdf } from './WalkListPdf'

// pdfkit writes standard-Helvetica glyphs in WinAnsi, whose 0x80–0x9F range is
// where the punctuation this document actually uses lives. Decoding the bytes
// as latin1 would silently swallow every em dash and apostrophe, and a test
// that can't see them can't tell a missing one from an encoded one.
const WIN_ANSI_HIGH = '€ ‚ƒ„…†‡ˆ‰Š‹Œ Ž  ‘’“”•–—˜™š›œ žŸ'

const decodeWinAnsi = (hex: string): string =>
  [...Buffer.from(hex, 'hex')]
    .map((byte) =>
      byte >= 0x80 && byte <= 0x9f
        ? WIN_ANSI_HIGH[byte - 0x80]
        : String.fromCharCode(byte),
    )
    .join('')

// Everything a reader sees, in the order the writer laid it down. pdfkit
// deflates each content stream, and kerning splits a word across several hex
// strings — so the streams are inflated, decoded, and joined with nothing
// between them.
const pdfText = (pdf: Buffer): string => {
  const raw = pdf.toString('latin1')
  const streams = /stream\r?\n/g
  const decoded: string[] = []
  let match: RegExpExecArray | null

  while ((match = streams.exec(raw)) !== null) {
    const start = match.index + match[0].length
    const end = raw.indexOf('endstream', start)
    if (end === -1) continue
    try {
      decoded.push(inflateSync(pdf.subarray(start, end)).toString('latin1'))
    } catch {
      // Fonts and metadata aren't deflated text; only content streams are.
    }
  }

  return [...decoded.join('\n').matchAll(/<([0-9a-fA-F]+)>/g)]
    .map(([, hex]) => decodeWinAnsi(hex as string))
    .join('')
}

const pageCount = (pdf: Buffer): number =>
  (pdf.toString('latin1').match(/\/Type \/Page[^s]/g) ?? []).length

const render = (stops: RoutePayloadStop[], turfName = 'Elm & Cedar') =>
  renderWalkListPdf({ turfName, payload: payload(stops) })

const renderText = async (stops: RoutePayloadStop[]): Promise<string> =>
  pdfText(await render(stops))

const household = (
  address: string,
  targets: RoutePayloadTarget[],
  otherResidents: { name: string | null }[] = [],
) => ({
  addressKey: address.toLowerCase().replace(/\s+/g, '|'),
  address,
  targets,
  otherResidents,
})

const oneDoor = (targets: RoutePayloadTarget[]) =>
  stop({ addresses: [household('105 Elm St', targets)] })

describe('WalkListPdf', () => {
  // The default fixture: one unknocked resident, whose sheet is the blank form
  // every other case is a departure from.
  let blank: string

  beforeAll(async () => {
    blank = await renderText([stop()])
  }, 30_000)

  it('titles the list and states what the walk costs', async () => {
    const text = await renderText([stop(), stop({ id: 12, seq: 2 })])

    expect(text).toContain('Elm & Cedar')
    expect(text).toContain(
      '2 stops · 2 doors · 2 people · Walking loop · 31 min travel · 2.0 mi',
    )
  })

  // The header states the route's total; this is the per-leg number, in the
  // address column under the door it leads to. Both paper surfaces word it with
  // `legTravelLine`, so a volunteer with the PDF and a canvasser with the
  // printed page read one leg the same way.
  it('prints the walk from the previous stop under the address', async () => {
    const text = await renderText([
      stop(),
      stop({ id: 12, seq: 2, legSeconds: 300 }),
    ])

    expect(text).toContain('5 min from last')
  })

  it('leaves the walk time off the first stop of a route', async () => {
    expect(await renderText([stop({ legSeconds: 0 })])).not.toContain(
      'from last',
    )
  })

  // The design template's own eight headings, in its own order. Uppercase
  // because the template tracks its column heads that way, and `textTransform`
  // reaches the glyphs the renderer writes rather than only the style it writes
  // them in. The two answer columns are headed with the app's own questions, so
  // the grid asks what the form it is transcribed back into asks.
  it('rules a grid with a heading for every column', () => {
    for (const heading of [
      '#',
      'NAME',
      'AGE',
      'ADDRESS',
      'PHONE',
      'DID THEY ANSWER?',
      'DO THEY SUPPORT YOU?',
      'NOTES',
    ]) {
      expect(blank).toContain(heading)
    }
  })

  // The same seven boxes the printable page offers, in the same order, because
  // both surfaces read the same two lists out of `walkFacts`. Order is not
  // cosmetic: paper is transcribed back into the form these came from, and a
  // reordered row is a mis-keyed answer. Spelled out rather than abbreviated to
  // `Y N ?` — the label goes under the box instead of beside it, which is the
  // room the old abbreviations were short for, and the template's 17% and 25%
  // are what bought out the grid's old two-of-five compression.
  it('pre-prints the mark options an unknocked door gets asked', () => {
    expect(blank).toContain('Dorian Fen')
    expect(blank).toContain('Independent')
    expect(blank).toContain(
      'ANSWEREDNOT HOMEINACCESSIBLE' + 'REFUSEDYESNOUNSURE',
    )
  })

  // The will-vote column merged away with the design template, which asks two
  // questions where the grid used to ask three. Pinned because the boxes are
  // generated from the form's constants and `WILL_VOTE_OPTIONS` is still one of
  // them — a third run of boxes would reappear silently otherwise.
  it('asks two questions, not the three it used to', () => {
    expect(blank).not.toMatch(/WILL VOTE/)
    expect(blank.match(/UNSURE/g)).toHaveLength(1)
  })

  // Neither surface says "Strong", "Lean", "Undec" or offers a "Moved" outcome:
  // none of them is a value `RecordKnockForm` accepts, and a box on paper the
  // form cannot accept is an answer nobody can file. What this pins is that the
  // boxes stay generated from the form's own constants.
  it('offers no answer the app has no value for', () => {
    for (const invented of [/strong/i, /\blean/i, /undec/i, /moved/i]) {
      expect(blank).not.toMatch(invented)
    }
  })

  // Age had led the meta line under the name and now has a column, so this is
  // the assertion that stops it being printed in both. Named against the party
  // it used to sit beside rather than counted, because the header's "31 min
  // travel" is the same two digits.
  it('prints the age in its column rather than under the name', () => {
    expect(blank).toContain('Dorian Fen' + 'Independent')
    expect(blank).not.toContain('31 · Independent')
  })

  // The template rules a Phone column and this is what fills it: cell first,
  // landline as the fallback, chosen by `targetPhone` so the two paper surfaces
  // cannot pick differently.
  it('prints the number to try when nobody answers, cell before landline', async () => {
    const both = await renderText([
      oneDoor([
        target({ cellPhone: '(312) 555-0101', landline: '(312) 555-0102' }),
      ]),
    ])
    expect(both).toContain('(312) 555-0101')
    expect(both).not.toContain('(312) 555-0102')

    const landlineOnly = await renderText([
      oneDoor([target({ cellPhone: null, landline: '(312) 555-0102' })]),
    ])
    expect(landlineOnly).toContain('(312) 555-0102')

    const neither = await renderText([
      oneDoor([target({ cellPhone: null, landline: null })]),
    ])
    expect(neither).not.toMatch(/555-010/)
  }, 30_000)

  // The Phone column is the *only* screen-side field the design brought onto
  // paper, and this is the rule it is an exception to rather than a repeal of. A
  // demographic profile of a named voter is a far larger disclosure than a
  // number is, on the one surface that stops being access-controlled the moment
  // it is printed. The fixture carries all eleven attributes, so this asserts
  // the omission rather than trusting it — and it checks the rendered text as
  // well as the row model, since a renderer could reach past the model into the
  // payload it is handed.
  it('never prints the demographic profile', async () => {
    const text = await renderText([oneDoor([target()])])

    for (const leak of [
      /Likely Married/,
      /Graduate Degree/,
      /Hispanic/,
      /Spanish/,
      /82,?000/,
      /\$75k/,
      /marital/i,
      /veteran/i,
      /homeowner/i,
      /ethnicity/i,
      /education/i,
      /income/i,
      /turnout/i,
      /demographic/i,
    ]) {
      expect(text).not.toMatch(leak)
    }
  })

  // ADR 0011. The largest disclosure on the payload — free text a named person
  // typed about a named voter — on the surface that stops being
  // access-controlled the moment it prints. The fixture carries a note and a
  // count of nine, and the count is asserted too: "9 notes on file" says how
  // much has been written about this voter even with none of it printed.
  //
  // The page's own "Notes" column heading is why this names the body rather
  // than the word: the blank column a canvasser writes in is the point of the
  // sheet, and asserting /notes/i would fail on the feature working.
  it('never prints a saved contact note', async () => {
    const text = await renderText([oneDoor([target()])])

    expect(text).not.toMatch(/Do not ring the bell/)
    expect(text).not.toMatch(/9 notes/i)
    expect(text).not.toMatch(/of 9/)
  })

  // Node's clock is UTC, so any date this stamps itself is tomorrow's for an
  // evening download anywhere in the US. The canvasser writes it instead.
  it('leaves the date and the canvasser to be written in', () => {
    expect(blank).toContain('Canvasser')
    expect(blank).toContain('Date')
    expect(blank).not.toMatch(/\b20\d\d\b/)
  })

  // The counter went with the design rather than moving. This renderer *can*
  // answer it — it lays the whole document out before it writes any of it — and
  // the printable page could only print a blank, which is why the two surfaces
  // used to read differently here at all. The template rules no counter on
  // either, so the asymmetry goes too.
  it('rules no page counter', () => {
    expect(blank).not.toMatch(/Page \d+ of \d+/)
  })

  // The design rules a single legend line. The notice about re-keying is not
  // dropped — it moved to the printable page's screen-only preamble, which is a
  // block paper has no equivalent of.
  it('says how to fill the sheet in, and nothing else in the legend', () => {
    expect(blank).toContain('Circle or tick a box, write short notes')
    expect(blank).not.toContain('reaches your voter records on its own')
  })

  // A door already logged in the app must not come back as a blank form —
  // that's how a knock gets repeated, or an answer overwritten on transcription.
  it('prints the recorded answer instead of blank boxes', async () => {
    const text = await renderText([
      oneDoor([target({ name: 'Marisol Vega', knockStatus: 'supporter' })]),
    ])

    expect(text).toContain('Marisol Vega')
    expect(text).toContain('Already logged: Supporter')
    expect(text).not.toContain('UNSURE')
  })

  // ADR 0007. Paper freezes the moment it downloads, so the instruction has to
  // travel on the page — and it outranks whatever was logged there before.
  it('prints the skip instruction for a flagged door and leaves it out of the header count', async () => {
    const text = await renderText([
      oneDoor([
        target({ stopTargetId: 21, name: 'Dorian Fen' }),
        target({
          stopTargetId: 22,
          personId: 'person-2',
          name: 'Marisol Vega',
          knockStatus: 'supporter',
          doNotKnock: true,
        }),
      ]),
    ])

    // One knockable conversation in the header, two names in the grid: the
    // header is the evening's work, the rows are the index.
    expect(text).toContain('1 stops · 1 doors · 1 people')
    expect(text).toContain('Marisol Vega')
    expect(text).toContain('Do not knock — skip this door')
    expect(text).not.toContain('Already logged: Supporter')
  })

  // ADR 0008. Same rule, different words: paper is the only surface used
  // without the app, so it carries the reason rather than a blank form.
  it('prints a reason as its skip instruction and leaves it out of the header count', async () => {
    const text = await renderText([
      oneDoor([
        target({ stopTargetId: 21, name: 'Dorian Fen' }),
        target({
          stopTargetId: 22,
          personId: 'person-2',
          name: 'Marisol Vega',
          notAVoterReason: 'deceased',
        }),
      ]),
    ])

    expect(text).toContain('1 stops · 1 doors · 1 people')
    expect(text).toContain('Marisol Vega')
    expect(text).toContain(
      'Deceased — skip this resident, and do not ask for them by name',
    )
  })

  // ENG-10876. The grid's blank form means "worth knocking", which reads the
  // same for a door nobody has been to and one that answered unsure — so the
  // resident cell carries what the app's feed would have shown. The note stays
  // off the page, like the phone numbers above.
  it('prints the last contact under the resident, without the note', async () => {
    const text = await renderText([
      oneDoor([
        target({
          history: [doorKnock({ note: 'Dog in the yard, come back Saturday' })],
        }),
      ]),
    ])

    expect(text).toContain('Last contact: June 2026 · Door knock: Answered')
    expect(text).not.toMatch(/Dog in the yard/)
    // Still a form to fill in: the line is context, not a recorded answer.
    expect(text).toContain('REFUSEDYESNOUNSURE')
  })

  // A household is one door however many people answer it, so the grid draws
  // its address once. Both residents still get their own row and their own form.
  it('prints a multi-resident household under one address', async () => {
    const text = await renderText([
      oneDoor([
        target({ stopTargetId: 21, name: 'Dorian Fen' }),
        target({ stopTargetId: 22, personId: 'person-2', name: 'Ada One' }),
      ]),
    ])

    expect(text.match(/105 Elm St/g)).toHaveLength(1)
    expect(text).toContain('Dorian Fen')
    expect(text).toContain('Ada One')
    // One blank form each: two runs of support boxes, not one shared.
    expect(text.match(/REFUSEDYESNOUNSURE/g)).toHaveLength(2)
  })

  it('repeats the header, the column headings and the footer on every page', async () => {
    const stops = Array.from({ length: 40 }, (_, index) =>
      stop({
        id: index + 1,
        seq: index + 1,
        addresses: [
          household(`${index + 1} Elm St`, [
            target({ stopTargetId: 100 + index }),
          ]),
        ],
      }),
    )
    const pdf = await render(stops)
    const text = pdfText(pdf)
    const pages = pageCount(pdf)

    expect(pages).toBeGreaterThan(1)
    expect(text.match(/empowering Independents/g)).toHaveLength(pages)
    // The column headings repeat, so a later page is still a table and not
    // eight unlabelled columns of handwriting.
    expect(text.match(/DO THEY SUPPORT YOU\?/g)).toHaveLength(pages)
    // And the route names itself on each one: sixteen sheets get separated, and
    // a page carrying only a grid belongs to no turf. There is no counter to
    // fall back on any more, which is what makes this the load-bearing half.
    expect(text.match(/Elm & Cedar/g)).toHaveLength(pages)
  }, 180_000)

  // The route can be empty — a turf whose targets were all filtered out still
  // has a name and a header, and the file has to open.
  it('degrades to a one-page sheet when the route has no stops', async () => {
    const pdf = await render([])
    const text = pdfText(pdf)

    expect(pageCount(pdf)).toBe(1)
    expect(text).toContain('Elm & Cedar')
    expect(text).toContain('0 stops · 0 doors · 0 people')
    expect(text).toContain('This route has no stops.')
    // Still signed, because an empty sheet is still one someone was handed.
    expect(text).toContain('empowering Independents')
    // No grid to head when there are no rows under it.
    expect(text).not.toContain('DO THEY SUPPORT YOU?')
  })
})
