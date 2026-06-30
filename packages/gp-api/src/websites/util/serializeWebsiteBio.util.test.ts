import { describe, expect, it } from 'vitest'
import { serializeWebsiteBio } from './serializeWebsiteBio.util'

describe('serializeWebsiteBio', () => {
  it('returns null for empty/whitespace/nullish bios', () => {
    expect(serializeWebsiteBio(null)).toBeNull()
    expect(serializeWebsiteBio(undefined)).toBeNull()
    expect(serializeWebsiteBio('')).toBeNull()
    expect(serializeWebsiteBio('   ')).toBeNull()
    expect(serializeWebsiteBio('<p></p>')).toBeNull()
  })

  it('strips HTML tags and trims', () => {
    expect(serializeWebsiteBio('<p>Fix the <strong>roads</strong></p>')).toBe(
      'Fix the roads',
    )
  })

  it('decodes common entities, leaving real text for the agent', () => {
    expect(serializeWebsiteBio('<p>Clean water &amp; air</p>')).toBe(
      'Clean water & air',
    )
  })

  it('decodes & last so an escaped entity does not collapse', () => {
    // "&amp;lt;" must round-trip to the literal "&lt;", not collapse to "<".
    expect(serializeWebsiteBio('<p>fund &amp;lt;$50M</p>')).toBe(
      'fund &lt;$50M',
    )
  })
})
