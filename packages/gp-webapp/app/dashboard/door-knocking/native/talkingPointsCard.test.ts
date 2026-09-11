import { describe, expect, it } from 'vitest'
import {
  composeCta,
  composeTalkingPointsBullets,
  DEPARTURE_NOTE,
  parseTalkingPoints,
  serializeTalkingPoints,
} from './talkingPointsCard'

const lines = {
  engagementQuestion: 'What would you fix around here first?',
  context: 'Fix our roads with a real maintenance plan, not patchwork.',
  cta: 'Point them to janedoe.org to learn more.',
  ask: 'Ask whether we can count on them in November.',
}

describe('serializeTalkingPoints', () => {
  it('writes the four sections in card order', () => {
    expect(serializeTalkingPoints(lines).split('\n')).toEqual([
      lines.engagementQuestion,
      lines.context,
      lines.cta,
      lines.ask,
    ])
  })

  it('round-trips', () => {
    expect(parseTalkingPoints(serializeTalkingPoints(lines))).toEqual(lines)
  })
})

// The delimiter cannot survive inside a section. The model's lines are
// collapsed server-side, but the step's four boxes are textareas — a typed
// Return or a pasted paragraph is the real source of one, and it would make
// a five-line card that `parseTalkingPoints` has to reject whole.
describe('serializeTalkingPoints', () => {
  it('collapses a section that contains a newline', () => {
    const stored = serializeTalkingPoints({
      ...lines,
      context: 'Fix the roads.\nAnd the sidewalks.',
    })

    expect(stored.split('\n')).toHaveLength(4)
    expect(stored.split('\n')[1]).toBe('Fix the roads. And the sidewalks.')
  })

  it('collapses runs of whitespace and trims the ends', () => {
    const stored = serializeTalkingPoints({
      ...lines,
      ask: '  Ask   them\t\tin November.  ',
    })

    expect(stored.split('\n')[3]).toBe('Ask them in November.')
  })
})

describe('parseTalkingPoints', () => {
  // Every list created before this shipped, which is what the door has to fall
  // back to the static script for.
  it('is null for a list with no stored card', () => {
    expect(parseTalkingPoints(null)).toBeNull()
    expect(parseTalkingPoints(undefined)).toBeNull()
    expect(parseTalkingPoints('')).toBeNull()
  })

  // A phone-banking or SMS script that landed on this column is prose, not
  // four lines. Rendering its first paragraph as an engagement question would
  // be worse than falling back.
  it('is null for anything that is not four lines', () => {
    expect(parseTalkingPoints('Hi, this is Jane calling about…')).toBeNull()
    expect(parseTalkingPoints('one\ntwo\nthree')).toBeNull()
    expect(parseTalkingPoints('one\ntwo\nthree\nfour\nfive')).toBeNull()
  })

  it('is null for four blank lines', () => {
    expect(parseTalkingPoints('\n\n\n')).toBeNull()
  })

  // A campaign with no website has no call to action to name. That is a blank
  // section, not a bad row, so the other three still reach the door.
  it('keeps a blank section rather than rejecting the card', () => {
    const parsed = parseTalkingPoints('Question?\nContext.\n\nAsk.')

    expect(parsed).toEqual({
      engagementQuestion: 'Question?',
      context: 'Context.',
      cta: '',
      ask: 'Ask.',
    })
  })
})

describe('composeCta', () => {
  it('names the website without its scheme, which nobody says out loud', () => {
    expect(composeCta('https://janedoe.org')).toBe(
      'Point them to janedoe.org to learn more — no commitment needed.',
    )
    expect(composeCta('http://janedoe.org')).toContain('janedoe.org')
  })

  it('is empty when there is no website on file', () => {
    expect(composeCta(null)).toBe('')
    expect(composeCta(undefined)).toBe('')
    expect(composeCta('  ')).toBe('')
  })
})

describe('composeTalkingPointsBullets', () => {
  it('reads as the stored four followed by the close', () => {
    expect(composeTalkingPointsBullets(lines)).toEqual([
      lines.engagementQuestion,
      lines.context,
      lines.cta,
      lines.ask,
      DEPARTURE_NOTE,
    ])
  })

  // A blank section drops out rather than printing an empty bullet at a door.
  it('drops a blank section', () => {
    expect(composeTalkingPointsBullets({ ...lines, cta: '' })).toEqual([
      lines.engagementQuestion,
      lines.context,
      lines.ask,
      DEPARTURE_NOTE,
    ])
  })

  // The close is a constant, so it is there even for a card with nothing else.
  it('always closes', () => {
    expect(
      composeTalkingPointsBullets({
        engagementQuestion: '',
        context: '',
        cta: '',
        ask: '',
      }),
    ).toEqual([DEPARTURE_NOTE])
  })
})
