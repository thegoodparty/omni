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

  it('represents a blank line as an empty paragraph', () => {
    const doc = markupToDoc('A\n\nB')
    expect(doc.content).toEqual([
      { type: 'paragraph', content: [{ type: 'text', text: 'A' }] },
      { type: 'paragraph' },
      { type: 'paragraph', content: [{ type: 'text', text: 'B' }] },
    ])
  })
})
