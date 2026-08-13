import { describe, expect, it } from 'vitest'
import { docToMarkup, markupToDoc } from './redlineDoc'

const roundTrip = (s: string): string => docToMarkup(markupToDoc(s))

describe('redline doc conversion', () => {
  it('round-trips plain, insertion, deletion, replacement, and blank lines', () => {
    for (const s of [
      'Section 1. Plain text.',
      'a {+new+} b',
      'a {-old-} b',
      '{-old-}{+new+}',
      'Section 1. Title.\n\n(a) {-old-}{+new+} clause.\n(b) kept.',
    ]) {
      expect(roundTrip(s)).toBe(s)
    }
  })

  it('builds marked text nodes for insertions and deletions', () => {
    expect(markupToDoc('x {-y-}{+z+}').content[0]?.content).toEqual([
      { type: 'text', text: 'x ' },
      { type: 'text', text: 'y', marks: [{ type: 'deletion' }] },
      { type: 'text', text: 'z', marks: [{ type: 'insertion' }] },
    ])
  })

  it('canonicalizes a marker spanning a newline to one per line (stable)', () => {
    // ProseMirror can't hold a mark across a paragraph boundary, so a marker
    // that spans a line break becomes one marker per line. Harmless and
    // idempotent: applying the round-trip again is a no-op.
    const once = roundTrip('{-line1\nline2-}')
    expect(once).toBe('{-line1-}\n{-line2-}')
    expect(roundTrip(once)).toBe(once)
  })

  it('preserves leading indentation whitespace', () => {
    expect(roundTrip('    (a) indented clause')).toBe('    (a) indented clause')
  })

  // A new (non-amendment) ordinance carries no markup, but it now edits in the
  // same editor as amendments, so its plain body must survive the doc round-trip
  // byte-for-byte or an untouched load would churn the saved text and stale the
  // quality-report hash. These cover the shapes real drafts actually contain.
  it('round-trips a realistic plain new-ordinance body byte-for-byte', () => {
    for (const s of [
      'ORDINANCE NO. ____\n\nAN ORDINANCE OF THE CITY OF EXAMPLE',
      'Section 1. Purpose.\n\n    (a) The purpose of this ordinance is to\n' +
        '        protect public health.\n    (b) It applies citywide.\n\n' +
        'Section 2. Definitions.\n\n    "Person" means any individual.',
      'Trailing newline stays.\n',
      'Line one\n\n\nLine four after two blank lines',
      '   \nleading whitespace-only line above',
      '',
    ]) {
      expect(roundTrip(s)).toBe(s)
    }
  })

  it('serializes the redline mark even when another mark is also present', () => {
    const doc = {
      content: [
        {
          content: [
            { text: 'x', marks: [{ type: 'bold' }, { type: 'insertion' }] },
          ],
        },
      ],
    }
    expect(docToMarkup(doc)).toBe('{+x+}')
  })

  it('serializes a hard break as a newline instead of dropping it', () => {
    const doc = {
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'line one' },
            { type: 'hardBreak' },
            { type: 'text', text: 'line two' },
          ],
        },
      ],
    }
    expect(docToMarkup(doc)).toBe('line one\nline two')
  })

  it('represents a blank line as an empty paragraph', () => {
    const doc = markupToDoc('A\n\nB')
    expect(doc.content).toEqual([
      { type: 'paragraph', content: [{ type: 'text', text: 'A' }] },
      { type: 'paragraph' },
      { type: 'paragraph', content: [{ type: 'text', text: 'B' }] },
    ])
  })
})
