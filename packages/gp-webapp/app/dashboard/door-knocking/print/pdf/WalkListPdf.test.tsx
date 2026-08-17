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
import { payload, stop, target } from './walkListFixtures'
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
      '2 stops · 2 doors · 2 people · Walking loop · 31 min · 2.0 mi',
    )
  })

  it('rules a grid with a heading for every column', () => {
    for (const heading of [
      'Address',
      'Resident',
      'Answered?',
      'Supports?',
      'Will vote?',
      'Notes',
    ]) {
      expect(blank).toContain(heading)
    }
  })

  // Y/N for answered; the app's own three answers, in the app's own order, for
  // the two follow-ups. Order is not cosmetic here: paper is transcribed back
  // into the form these came from, and a reordered row is a mis-keyed answer.
  it('pre-prints the tick options an unknocked door gets asked', () => {
    expect(blank).toContain('Dorian Fen')
    expect(blank).toContain('31 · Independent')
    expect(blank).toContain('YN' + 'Y?N' + 'Y?N')
  })

  // Paper leaves the building and stops being access-controlled when it does.
  // The fixture carries both numbers, so this asserts the omission.
  it('never prints a phone number', async () => {
    const text = await renderText([
      oneDoor([
        target({ cellPhone: '(312) 555-0101', landline: '(312) 555-0102' }),
      ]),
    ])

    expect(text).not.toMatch(/555-010/)
    expect(text).not.toMatch(/phone/i)
    expect(text).not.toMatch(/landline/i)
  })

  // Node's clock is UTC, so any date this stamps itself is tomorrow's for an
  // evening download anywhere in the US. The canvasser writes it instead.
  it('leaves the date to the canvasser rather than stamping one', () => {
    expect(blank).toContain('Date walked')
    expect(blank).not.toMatch(/\b20\d\d\b/)
  })

  it('says nothing on the page reaches the voter records on its own', () => {
    expect(blank).toContain('reaches your voter records on its own')
  })

  it('leaves room for notes on the last page', () => {
    expect(blank).toContain('Additional notes')
  })

  // A door already logged in the app must not come back as a blank form —
  // that's how a knock gets repeated, or an answer overwritten on transcription.
  it('prints the recorded answer instead of blank boxes', async () => {
    const text = await renderText([
      oneDoor([target({ name: 'Marisol Vega', knockStatus: 'supporter' })]),
    ])

    expect(text).toContain('Marisol Vega')
    expect(text).toContain('Already logged: Supporter')
    expect(text).not.toContain('Y?N')
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
    expect(text.match(/Y\?N/g)).toHaveLength(4)
  })

  it('gives every page the footer, the tagline, a page number and the column headings', async () => {
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
    for (let page = 1; page <= pages; page++) {
      expect(text).toContain(`Page ${page} of ${pages}`)
    }
    expect(
      text.match(/Empowering people to run, win, and serve/g),
    ).toHaveLength(pages)
    // The column headings repeat, so a later page is still a table and not
    // seven unlabelled columns of handwriting.
    expect(text.match(/Will vote\?/g)).toHaveLength(pages)
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
    expect(text).toContain('Additional notes')
    // No grid to head when there are no rows under it.
    expect(text).not.toContain('Will vote?')
  })
})
