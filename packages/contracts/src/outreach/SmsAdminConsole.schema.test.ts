import { describe, expect, it } from 'vitest'
import { checkSmsStandards, findLinkShortener } from './SmsAdminConsole.schema'

// A message that satisfies every other rule, so a verdict's failures are only
// ever about the thing a test is exercising.
const compliant = (body: string) =>
  [
    'Hello {first_name}, this is Jane Doe running for County Commissioner.',
    body,
    'Paid for by Friends of Jane.',
    'Reply STOP to opt out.',
  ].join('\n')

const verdictFor = (script: string) =>
  checkSmsStandards(script, {
    candidateNames: ['Jane Doe'],
    committeeName: 'Friends of Jane',
  })

describe('checkSmsStandards', () => {
  it('passes a message carrying every required element', () => {
    expect(verdictFor(compliant('Vote on Nov 3.'))).toEqual({
      passed: true,
      failures: [],
    })
  })

  // The failure that charged a candidate $634.10 for a send Peerly then
  // refused (campaign 325980, 2026-09-30).
  it('fails a message containing a bit.ly link', () => {
    const verdict = verdictFor(
      compliant('Donations here: https://bit.ly/47ri12e'),
    )
    expect(verdict.passed).toBe(false)
    expect(verdict.failures).toEqual(['link_shortener'])
  })

  it('fails on the other shorteners Peerly names, whatever the case', () => {
    for (const link of [
      'TinyURL.com/abc',
      'http://www.bit.ly/abc',
      'ow.ly/xyz',
      'go to t.co/abc now',
    ]) {
      expect(verdictFor(compliant(link)).failures).toContain('link_shortener')
    }
  })

  it('leaves a full donation URL alone', () => {
    // The URL this candidate replaced the shortener with, which Peerly
    // accepted: a short domain is not a shortener.
    expect(
      verdictFor(compliant('Donations here: give.blue/jane-doe-1')).passed,
    ).toBe(true)
  })

  it('does not match a domain that merely ends in a shortener', () => {
    expect(
      verdictFor(compliant('See orbit.lyrics.example.com/song')).passed,
    ).toBe(true)
  })
})

describe('findLinkShortener', () => {
  it('names the domain so the candidate can find the line', () => {
    expect(findLinkShortener('Donations: https://bit.ly/47ri12e')).toBe('bit.ly')
    expect(findLinkShortener('see www.TinyURL.com/x')).toBe('tinyurl.com')
  })

  it('returns null when there is nothing to fix', () => {
    expect(findLinkShortener('Donations: give.blue/jane-doe-1')).toBeNull()
  })
})
