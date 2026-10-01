import { describe, expect, it, vi } from 'vitest'
import { renderHook } from '@testing-library/react'
import { SERVE_SMS_SURFACE, useServeSmsSignedBody } from './SmsFlow'

vi.mock('@shared/hooks/useCampaign', () => ({
  useCampaign: () => [null],
}))
vi.mock('@shared/hooks/useUser', () => ({
  useUser: () => [{ firstName: 'Bryan', lastName: 'Levine' }],
}))
vi.mock('@shared/hooks/usePositionName', () => ({
  usePositionName: () => 'Asheville City Council',
}))

const sign = () => renderHook(() => useServeSmsSignedBody()).result.current

const greetings = (text: string) =>
  text.match(/\b(?:hello|hi|hey)\b/gi)?.length ?? 0

describe('useServeSmsSignedBody', () => {
  // A persisted card from before the server guard: its own intro, with a
  // placeholder, opened the drawer behind the compliant one.
  it('replaces the draft’s own self-introduction, placeholder and all', () => {
    const signed = sign()(
      "Hi, this is [Your Name] from the City of Asheville. We're working on expanding composting options. Would you use a drop-off site?",
    )

    expect(signed).toBe(
      "this is Bryan, your Asheville City Council Member. We're working on expanding composting options. Would you use a drop-off site?",
    )
    const composed = SERVE_SMS_SURFACE.composeMessage(signed, null)
    expect(composed).toMatch(
      /^Hello \{\{first_name\}\}, this is Bryan, your Asheville City Council Member\. We're/,
    )
    expect(greetings(composed)).toBe(1)
    expect(composed).not.toContain('[')
  })

  it('replaces an opener that names the body instead of the person', () => {
    const signed = sign()(
      'This is the City Council. Is the flooding on your block still a problem?',
    )

    expect(signed).toBe(
      'this is Bryan, your Asheville City Council Member. Is the flooding on your block still a problem?',
    )
  })

  it('fills a leftover sender placeholder with the official’s first name', () => {
    expect(
      sign()('Hello! Is the flooding still a problem? Thanks, [Name]'),
    ).toBe(
      'this is Bryan, your Asheville City Council Member. Is the flooding still a problem? Thanks, Bryan',
    )
  })

  it('leaves a message that already names the official as written', () => {
    const body =
      'this is Bryan Levine, your Asheville City Council Member. Is the flooding still a problem?'

    expect(sign()(body)).toBe(body)
    expect(greetings(SERVE_SMS_SURFACE.composeMessage(body, null))).toBe(1)
  })
})
