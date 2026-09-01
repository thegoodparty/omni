import { describe, expect, it } from 'vitest'
import { trimDraftToDialogueBoundary } from './outreachPhoneBankingGeneration.service'

describe('trimDraftToDialogueBoundary', () => {
  it('passes an under-cap draft through untouched', () => {
    const draft = 'You: Hi, is this Jane?\nVoter: Yes, speaking.'

    expect(trimDraftToDialogueBoundary(draft, 2000)).toBe(draft)
  })

  it('trims an over-cap multi-line draft to the last whole dialogue line', () => {
    const lines = [
      'You: Hi, is this the voter? My name is Alex.',
      'Voter: Yes, this is her.',
      'You: I am a volunteer for Jane Doe, running for city council.',
      'Voter: Oh, I have heard of her.',
      'You: and please have a great res',
    ]
    const draft = lines.join('\n')
    // Cuts partway through the last line ("You: and please have a great
    // res") — anywhere strictly inside it exercises the same last-newline
    // boundary, since the newline before it is what the function finds.
    const maxLength = draft.length - 10

    const result = trimDraftToDialogueBoundary(draft, maxLength)

    expect(result.length).toBeLessThanOrEqual(maxLength)
    expect(result).toBe(lines.slice(0, 4).join('\n'))
    expect(result.endsWith('\n')).toBe(false)
    expect(result.endsWith(' ')).toBe(false)
  })

  it('trims a no-newline over-cap draft at the last word boundary', () => {
    const draft =
      'You: Hi, is this the voter? My name is Alex and I am a volunteer ' +
      'for Jane Doe who is running for city council in this election'
    const maxLength = draft.length - 5

    const result = trimDraftToDialogueBoundary(draft, maxLength)

    expect(result.length).toBeLessThanOrEqual(maxLength)
    expect(draft.startsWith(result)).toBe(true)
    // A clean word-boundary cut: the very next character in the original
    // draft (the one trimmed away) is whitespace, never mid-word.
    expect(draft.slice(result.length, result.length + 1)).toMatch(/\s/)
    expect(result.endsWith(' ')).toBe(false)
  })

  it('falls back to a raw slice when the draft has no whitespace at all', () => {
    const draft = 'y'.repeat(2010)
    const maxLength = 2000

    const result = trimDraftToDialogueBoundary(draft, maxLength)

    expect(result).toBe(draft.slice(0, maxLength))
    expect(result).toHaveLength(maxLength)
  })

  it('never returns an empty string for a non-empty draft', () => {
    const draft = ' '.repeat(2010)
    const maxLength = 2000

    const result = trimDraftToDialogueBoundary(draft, maxLength)

    expect(result.length).toBeGreaterThan(0)
  })
})
