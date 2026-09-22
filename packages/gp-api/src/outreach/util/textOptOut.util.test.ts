import { describe, expect, it } from 'vitest'
import { isOptOutMessage } from './textOptOut.util'

describe('isOptOutMessage', () => {
  it.each([
    'STOP',
    'stop',
    '  Stop.  ',
    'STOP!!!',
    'stopall',
    'STOP ALL',
    'UNSUBSCRIBE',
    'Unsubscribe please',
    'please stop',
    'quit',
    'opt out',
    'OPTOUT',
  ])('treats the standalone keyword %j as an opt-out', (content) => {
    expect(isOptOutMessage(content)).toBe(true)
  })

  // The CTIA floor: these are ordinary verbs, so a whole message of just
  // the keyword counts and a sentence inside a longer message does not.
  it.each(['CANCEL', 'End', 'remove', 'Cancel.', 'please cancel'])(
    'treats the whole message %j as an opt-out',
    (content) => {
      expect(isOptOutMessage(content)).toBe(true)
    },
  )

  it.each([
    // The exact false positive the tiering exists to prevent: the trailing
    // word of a multi-sentence message normalizes to a bare keyword.
    'I support the budget. End.',
    'Great news about the park. End.',
    'The session will end. Thanks for the update.',
    'We should cancel. The timing is wrong.',
    'Can you remove the sign? Thanks.',
    'Fund the library. Cancel the stadium.',
    'That contract should end.',
  ])('does not read the trailing-verb message %j as an opt-out', (content) => {
    expect(isOptOutMessage(content)).toBe(false)
  })

  it.each([
    'Please stop texting me',
    'Hey, stop texting me about this',
    "don't text me again",
    'Do not contact me',
    'Remove me from your list',
    'take me off this list',
    'Please delete my number',
    'no more texts please',
    'lose my number',
    'leave me alone',
    'I want to opt out',
    'unsubscribe me',
    'opt me out',
  ])('treats the revocation phrase %j as an opt-out', (content) => {
    expect(isOptOutMessage(content)).toBe(true)
  })

  it('reads a standalone keyword sentence inside a longer reply', () => {
    expect(isOptOutMessage('The noise is unbearable. STOP')).toBe(true)
    expect(isOptOutMessage('Stop. I never signed up for this.')).toBe(true)
  })

  it.each([
    'Please stop the warehouse project',
    'The noise from the site needs to stop',
    'We should cancel the rezoning hearing',
    'Potholes on Elm need fixing',
    'Thanks for the update!',
    'Can you end the contract with the developer?',
    'I want to stop by your office hours',
    '',
  ])('does not read %j as an opt-out', (content) => {
    expect(isOptOutMessage(content)).toBe(false)
  })

  it('is null-safe', () => {
    expect(isOptOutMessage(null)).toBe(false)
    expect(isOptOutMessage(undefined)).toBe(false)
  })
})
