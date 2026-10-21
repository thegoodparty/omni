import { describe, expect, it } from 'vitest'
import {
  getUrlHostname,
  normalizePersonName,
  phoneDigitsKey,
  urlHasCredentials,
} from './strings.util'

// The host-spoof case these guards defend against: the WHATWG parser reads the
// host from *after* the '@', so a naive host check on this value sees evil.gov.
const SPOOF_URL = 'https://goodparty.org@evil.gov/x'
const PLAIN_URL = 'https://goodparty.org/path'
const CREDENTIALED_URL = 'http://user:pass@example.com/x'
const EXPECTED_HOST = 'goodparty.org'

describe('getUrlHostname', () => {
  it('returns the lowercased host of a plain URL', () => {
    expect(getUrlHostname(PLAIN_URL)).toBe(EXPECTED_HOST)
  })

  it('strips a leading www.', () => {
    expect(getUrlHostname('https://www.goodparty.org')).toBe(EXPECTED_HOST)
  })

  it('adds a scheme when the input has none (bare domain)', () => {
    expect(getUrlHostname('goodparty.org/path')).toBe(EXPECTED_HOST)
  })

  it('resolves protocol-relative inputs', () => {
    expect(getUrlHostname('//example.com/x')).toBe('example.com')
  })

  it('refuses to return a host when the URL carries credentials', () => {
    expect(getUrlHostname(CREDENTIALED_URL)).toBe('')
  })

  it('refuses the userinfo host-spoof case (goodparty.org@evil.gov)', () => {
    // Without the credentials guard this would leak the spoofed host.
    expect(getUrlHostname(SPOOF_URL)).toBe('')
  })

  it('returns an empty string for an unparseable URL', () => {
    expect(getUrlHostname('not a url')).toBe('')
  })

  it('returns an empty string for empty input', () => {
    expect(getUrlHostname('')).toBe('')
  })
})

describe('urlHasCredentials', () => {
  it('is false for a plain URL', () => {
    expect(urlHasCredentials(PLAIN_URL)).toBe(false)
  })

  it('is true when user:pass credentials are embedded', () => {
    expect(urlHasCredentials(CREDENTIALED_URL)).toBe(true)
  })

  it('is true for the userinfo host-spoof case (username only)', () => {
    expect(urlHasCredentials(SPOOF_URL)).toBe(true)
  })

  it('is false (parse-failure fallback) for an unparseable URL', () => {
    expect(urlHasCredentials('not a url')).toBe(false)
  })

  it('is false for empty input', () => {
    expect(urlHasCredentials('')).toBe(false)
  })
})

describe('phoneDigitsKey', () => {
  const KEY = '3035550101'

  it.each([
    ['+13035550101', 'E.164'],
    ['13035550101', 'bare 11-digit (Peerly report shape)'],
    ['3035550101', 'bare 10-digit'],
    ['(303) 555-0101', 'formatted'],
  ])('reduces %s (%s) to the same 10-digit key', (input) => {
    expect(phoneDigitsKey(input)).toBe(KEY)
  })

  it.each([
    ['', 'empty'],
    ['555-0101', 'too short'],
    ['2303555010199', 'too long'],
  ])('returns null for %s (%s) instead of throwing', (input) => {
    expect(phoneDigitsKey(input)).toBeNull()
  })
})

describe('normalizePersonName', () => {
  it('capitalizes an all-lowercase name', () => {
    expect(normalizePersonName('stewart')).toBe('Stewart')
  })

  it('capitalizes each word across spaces, hyphens and apostrophes', () => {
    expect(normalizePersonName("mary-jane o'brien")).toBe("Mary-Jane O'Brien")
  })

  it('capitalizes accented lowercase letters', () => {
    expect(normalizePersonName('élodie')).toBe('Élodie')
  })

  it('leaves mixed-case spellings as typed', () => {
    expect(normalizePersonName('McDonald')).toBe('McDonald')
    expect(normalizePersonName('de La Cruz')).toBe('de La Cruz')
  })

  it('leaves all-caps input as typed', () => {
    expect(normalizePersonName('JR')).toBe('JR')
  })

  it('returns an empty string unchanged', () => {
    expect(normalizePersonName('')).toBe('')
  })
})
