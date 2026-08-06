import { describe, expect, it } from 'vitest'
import {
  hasRedline,
  parseRedline,
  parseRedlineLines,
  redlineToOriginal,
  serializeRedline,
  type RedlineSegment,
} from './redline'

describe('parseRedline', () => {
  it('treats plain text as a single unchanged segment', () => {
    expect(parseRedline('Section 1. No AI.')).toEqual([
      { type: 'unchanged', text: 'Section 1. No AI.' },
    ])
  })

  it('parses a pure insertion', () => {
    expect(parseRedline('a {+new+} b')).toEqual([
      { type: 'unchanged', text: 'a ' },
      { type: 'insertion', text: 'new' },
      { type: 'unchanged', text: ' b' },
    ])
  })

  it('parses a pure deletion', () => {
    expect(parseRedline('a {-old-} b')).toEqual([
      { type: 'unchanged', text: 'a ' },
      { type: 'deletion', text: 'old' },
      { type: 'unchanged', text: ' b' },
    ])
  })

  it('parses an adjacent replacement (deletion then insertion)', () => {
    expect(parseRedline('{-old-}{+new+}')).toEqual([
      { type: 'deletion', text: 'old' },
      { type: 'insertion', text: 'new' },
    ])
  })

  it('parses the 106.145 title replacement verbatim', () => {
    const body =
      '106.145 {-Use of Artificial Intelligence-}' +
      '{+Artificial Intelligence Disclosure Required+}.'
    expect(parseRedline(body)).toEqual([
      { type: 'unchanged', text: '106.145 ' },
      { type: 'deletion', text: 'Use of Artificial Intelligence' },
      {
        type: 'insertion',
        text: 'Artificial Intelligence Disclosure Required',
      },
      { type: 'unchanged', text: '.' },
    ])
  })

  it('emits an unterminated open marker as literal text', () => {
    expect(parseRedline('keep {- dangling')).toEqual([
      { type: 'unchanged', text: 'keep {- dangling' },
    ])
  })

  it('does not treat a lone hyphen or brace in prose as a marker', () => {
    const body = 'a 30-day limit {not a marker}'
    expect(parseRedline(body)).toEqual([{ type: 'unchanged', text: body }])
  })
})

describe('serializeRedline round-trips', () => {
  const cases = [
    'plain statute text',
    'a {+insert+} here',
    'a {-delete-} here',
    '{-old-}{+new+}',
    'lead {-a-} mid {+b+} tail',
    'unterminated {- stays literal',
    '106.145 {-Use of AI-}{+AI Disclosure+}.\n\n(1) ...',
  ]
  it.each(cases)('serialize(parse(x)) === x for %j', (x) => {
    expect(serializeRedline(parseRedline(x))).toBe(x)
  })
})

describe('redlineToOriginal', () => {
  it('reconstructs the before text (keeps deletions, drops insertions)', () => {
    const body =
      'The disclaimer {-must-}{+shall+} appear for {-3-}{+[3]+} seconds.'
    expect(redlineToOriginal(body)).toBe(
      'The disclaimer must appear for 3 seconds.',
    )
  })

  it('leaves a plain draft unchanged', () => {
    const plain = 'A brand-new ordinance with no markup.'
    expect(redlineToOriginal(plain)).toBe(plain)
  })
})

describe('parseRedlineLines', () => {
  it('splits into one segment list per line, marked runs intact', () => {
    expect(parseRedlineLines('a {-x-}{+y+} b\n\n(c) plain')).toEqual([
      [
        { type: 'unchanged', text: 'a ' },
        { type: 'deletion', text: 'x' },
        { type: 'insertion', text: 'y' },
        { type: 'unchanged', text: ' b' },
      ],
      [],
      [{ type: 'unchanged', text: '(c) plain' }],
    ])
  })

  it('splits a marker that spans a newline into one segment per line', () => {
    expect(parseRedlineLines('{-line1\nline2-}')).toEqual([
      [{ type: 'deletion', text: 'line1' }],
      [{ type: 'deletion', text: 'line2' }],
    ])
  })
})

describe('hasRedline', () => {
  it('detects deletion or insertion markers', () => {
    expect(hasRedline('a {-x-} b')).toBe(true)
    expect(hasRedline('a {+x+} b')).toBe(true)
  })

  it('is false for plain text', () => {
    expect(hasRedline('a 30-day {brace} limit')).toBe(false)
  })
})

describe('serializeRedline', () => {
  it('is the inverse of parse for hand-built segments', () => {
    const segments: RedlineSegment[] = [
      { type: 'unchanged', text: 'x ' },
      { type: 'deletion', text: 'y' },
      { type: 'insertion', text: 'z' },
    ]
    expect(serializeRedline(segments)).toBe('x {-y-}{+z+}')
  })
})
