import { describe, expect, it } from 'vitest'
import { ContrastToneService } from './contrastTone.service'

const tone = new ContrastToneService()

describe('ContrastToneService.isCategoryAllowed', () => {
  it('allows a public-conduct category (normalized)', () => {
    expect(tone.isCategoryAllowed('voting_record')).toBe(true)
    expect(tone.isCategoryAllowed('Public Record')).toBe(true)
    expect(tone.isCategoryAllowed('public-record')).toBe(true)
  })

  it('rejects family/health/private-life/rumor', () => {
    expect(tone.isCategoryAllowed('family')).toBe(false)
    expect(tone.isCategoryAllowed('health')).toBe(false)
    expect(tone.isCategoryAllowed('private_life')).toBe(false)
    expect(tone.isCategoryAllowed('rumor')).toBe(false)
  })
})

describe('ContrastToneService.check', () => {
  it('leaves a clean sentence untouched and not near-the-line', () => {
    const input =
      'On Housing, my opponent voted against the bill — I support it.'
    const result = tone.check(input)
    expect(result.nearTheLine).toBe(false)
    expect(result.sentence).toBe(input)
  })

  it('strips inflation terms and flags near-the-line', () => {
    const result = tone.check(
      'My corrupt opponent is a dangerous extremist and reckless.',
    )
    expect(result.nearTheLine).toBe(true)
    expect(result.sentence).not.toMatch(/corrupt|dangerous|extremist|reckless/i)
    // No double spaces left behind by the strip.
    expect(result.sentence).not.toMatch(/ {2}/)
  })

  it('leaves factual political vocabulary untouched', () => {
    // 'failed' and 'agenda' are routine factual terms, not inflation: a
    // legitimate sourced contrast must survive the tone pass unchanged.
    const input =
      'On the budget, my opponent failed to vote on HB-412 — I co-sponsored it.'
    const result = tone.check(input)
    expect(result.nearTheLine).toBe(false)
    expect(result.sentence).toBe(input)
  })

  it('leaves no stranded punctuation for comma-separated inflation terms', () => {
    const result = tone.check('He has a corrupt, reckless, greedy record.')
    expect(result.nearTheLine).toBe(true)
    expect(result.sentence).not.toMatch(/corrupt|reckless|greedy/i)
    // The strip must not leave dangling commas or double spaces behind.
    expect(result.sentence).not.toMatch(/ {2}/)
    expect(result.sentence).not.toMatch(/(^|\s)[,;:]/)
    expect(result.sentence).toBe('He has a record.')
  })
})
