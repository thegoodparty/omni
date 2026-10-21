import { describe, expect, it } from 'vitest'
import { containsLine, normalizeLine } from './normalizeLine'

describe('normalizeLine', () => {
  it('collapses runs of whitespace and trims', () => {
    expect(normalizeLine('  This is\n\na   draft. ')).toBe('This is a draft.')
  })

  it('folds curly quotes and apostrophes to straight ones', () => {
    expect(normalizeLine('‘It’s a “draft”’')).toBe("'It's a \"draft\"'")
  })

  it('applies NFKC, so a non-breaking space becomes a space', () => {
    expect(normalizeLine('a draft')).toBe('a draft')
  })

  it('leaves dashes and case alone', () => {
    expect(normalizeLine('Draft — Not Sent')).toBe('Draft — Not Sent')
  })
})

describe('containsLine', () => {
  const line = 'This is a draft. Nothing is sent until you send it.'

  it('matches a line the model wrote with curly punctuation and odd spacing', () => {
    const reply =
      'Here is the text.\n\nThis is a draft.  Nothing is sent until\nyou send it.'
    expect(containsLine(reply, line)).toBe(true)
  })

  it('does not match a reworded line', () => {
    expect(containsLine('This is a draft. Nothing is sent yet.', line)).toBe(
      false,
    )
  })
})
