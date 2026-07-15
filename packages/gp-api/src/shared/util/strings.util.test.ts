import { describe, expect, it } from 'vitest'
import { getUrlHostname, urlHasCredentials } from './strings.util'

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
