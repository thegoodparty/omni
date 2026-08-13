import { describe, expect, it } from 'vitest'
import {
  buildMagicLinkShortUrl,
  buildMagicLinkSmsBody,
  gsm7SegmentCount,
  gsm7Septets,
  isGsm7,
} from './magicLinkSms.util'

// The realistic worst case: prod's origin is the longest we ship, and slugs are
// always nanoid(12).
const PROD_SHORT_URL = 'https://app.goodparty.org/s/K7m2Qx4bNp3v'

describe('buildMagicLinkShortUrl', () => {
  it('builds a /s/<slug> path on the app origin', () => {
    expect(buildMagicLinkShortUrl('K7m2Qx4bNp3v')).toMatch(
      /^https?:\/\/.+\/s\/K7m2Qx4bNp3v$/,
    )
  })
})

describe('buildMagicLinkSmsBody', () => {
  const body = buildMagicLinkSmsBody(PROD_SHORT_URL)

  it('fits in a single SMS segment', () => {
    // The whole reason the short link exists. If this fails, either the copy grew
    // or the link did, and the message now costs multiple segments.
    expect(gsm7SegmentCount(body)).toBe(1)
    expect(gsm7Septets(body)).toBeLessThanOrEqual(160)
  })

  it('is GSM-7 encodable', () => {
    // A single curly apostrophe or emoji drops the budget to 70 characters and
    // silently splits the message.
    expect(isGsm7(body)).toBe(true)
  })

  it('carries the brand name, the link and STOP language', () => {
    expect(body).toContain('GoodParty')
    expect(body).toContain(PROD_SHORT_URL)
    expect(body).toContain('STOP')
  })
})

describe('gsm7 helpers', () => {
  it('rejects non-GSM-7 characters', () => {
    // U+2019, the curly apostrophe an editor substitutes for '
    const curly = 'that\u2019s a problem'
    expect(isGsm7(curly)).toBe(false)
    expect(gsm7Septets(curly)).toBeNull()
    expect(gsm7SegmentCount(curly)).toBeNull()
  })

  it('counts extension-set characters as two septets', () => {
    expect(gsm7Septets('a')).toBe(1)
    expect(gsm7Septets('[')).toBe(2)
    expect(gsm7Septets('€')).toBe(2)
  })

  it('switches to 153-septet parts once concatenation is needed', () => {
    expect(gsm7SegmentCount('a'.repeat(160))).toBe(1)
    expect(gsm7SegmentCount('a'.repeat(161))).toBe(2)
    expect(gsm7SegmentCount('a'.repeat(306))).toBe(2)
    expect(gsm7SegmentCount('a'.repeat(307))).toBe(3)
  })
})
