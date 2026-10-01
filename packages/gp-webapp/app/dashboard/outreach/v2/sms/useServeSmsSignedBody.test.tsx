import { describe, expect, it, vi } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useServeSmsSignedBody } from './SmsFlow'

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

describe('useServeSmsSignedBody', () => {
  // A chat card's draft opened the compose step on "messages must include
  // your name". Signing it the way the step's own drafts open avoids that.
  it('opens an unsigned message with the official’s own intro', () => {
    const signed = sign()(
      'This is the Asheville City Council. Is the flooding on your block still a problem?',
    )

    expect(signed).toMatch(
      /^this is Bryan, your Asheville City Council Member\. /,
    )
    expect(signed).toContain('Is the flooding on your block still a problem?')
  })

  it('leaves a message that already names the official as written', () => {
    const body =
      'this is Bryan Levine, your Asheville City Council Member. Is the flooding still a problem?'

    expect(sign()(body)).toBe(body)
  })

  // Anything else is the compose step's to flag, the way it flags a typed
  // edit; only the missing name is fixed ahead of it.
  it('does not touch a message that fails for another reason', () => {
    const body = `This is the council. ${'x'.repeat(2100)}`

    expect(sign()(body)).toBe(body)
  })
})
