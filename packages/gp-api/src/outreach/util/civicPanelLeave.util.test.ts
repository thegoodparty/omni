import { describe, expect, it } from 'vitest'
import { isCivicPanelLeaveMessage } from './civicPanelLeave.util'
import { isOptOutMessage } from './textOptOut.util'

describe('isCivicPanelLeaveMessage', () => {
  it.each([
    'LEAVE',
    'leave',
    'Leave!',
    ' leave. ',
    'Leave please',
    'leave the panel',
    'Thanks for asking. LEAVE',
    'Not for me anymore\nLeave',
  ])('reads %j as leaving', (reply) => {
    expect(isCivicPanelLeaveMessage(reply)).toBe(true)
  })

  it.each([
    '',
    null,
    undefined,
    'I had to leave the meeting early',
    'leaves',
    'Do not leave the park as it is',
    'JOIN',
    'STOP',
  ])('does not read %j as leaving', (reply) => {
    expect(isCivicPanelLeaveMessage(reply)).toBe(false)
  })

  it('is not an opt-out, so the office can still text them', () => {
    expect(isOptOutMessage('LEAVE')).toBe(false)
  })
})
