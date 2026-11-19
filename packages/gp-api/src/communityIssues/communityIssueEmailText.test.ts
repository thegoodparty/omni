import { describe, expect, it } from 'vitest'
import { shortTitle, teaser, truncateOnWord } from './communityIssueEmailText'

describe('truncateOnWord', () => {
  it('returns short text unchanged', () => {
    expect(truncateOnWord('Pothole backlog', 60)).toBe('Pothole backlog')
  })
  it('collapses whitespace', () => {
    expect(truncateOnWord('  a \n b  ', 60)).toBe('a b')
  })
  it('cuts on a word boundary with an ellipsis within the limit', () => {
    const out = truncateOnWord('one two three four five six', 15)
    expect(out).toBe('one two three…')
    expect(out.length).toBeLessThanOrEqual(15)
  })
  it('hard-cuts a single long word', () => {
    const out = truncateOnWord('x'.repeat(100), 10)
    expect(out).toBe(`${'x'.repeat(9)}…`)
  })
  it('keeps text exactly at the limit', () => {
    expect(truncateOnWord('a'.repeat(60), 60)).toBe('a'.repeat(60))
  })
})

describe('shortTitle / teaser', () => {
  it('caps at 60 and 120 chars', () => {
    const long = 'word '.repeat(100)
    expect(shortTitle(long).length).toBeLessThanOrEqual(60)
    expect(teaser(long).length).toBeLessThanOrEqual(120)
    expect(shortTitle(long).endsWith('…')).toBe(true)
  })
})
