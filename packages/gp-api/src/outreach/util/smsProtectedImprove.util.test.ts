import { describe, expect, it } from 'vitest'
import { deriveSmsProtectedParts } from '@goodparty_org/contracts'
import {
  maskProtectedParts,
  restoreProtectedParts,
} from './smsProtectedImprove.util'

const SCRIPT =
  "Hello {first_name}, it's Sarah Chen, running for city council. Vote Nov 3!\n\nPaid for by Friends of Sarah Chen. Reply STOP to opt out."
const PROTECTION = {
  candidateNames: ['Sarah Chen'],
  committeeName: 'Friends of Sarah Chen',
}

const maskedScript = () =>
  maskProtectedParts(SCRIPT, deriveSmsProtectedParts(SCRIPT, PROTECTION))

describe('maskProtectedParts', () => {
  it('replaces every locked part with a numbered marker, in order', () => {
    const { masked, locked } = maskedScript()
    expect(masked).toBe(
      "Hello ⟦1⟧, it's ⟦2⟧, running for city council. Vote Nov 3!\n\n⟦3⟧. ⟦4⟧",
    )
    expect(locked).toEqual([
      '{first_name}',
      'Sarah Chen',
      'Paid for by Friends of Sarah Chen',
      'Reply STOP to opt out.',
    ])
  })

  it('never shows the model any locked text', () => {
    const { masked } = maskedScript()
    for (const text of [
      'Sarah Chen',
      'Paid for by',
      'Reply STOP',
      '{first_name}',
    ]) {
      expect(masked).not.toContain(text)
    }
  })

  it('masks a merge tag every time it appears', () => {
    const script = '{first_name}, yes you {first_name}. Reply STOP'
    const { masked } = maskProtectedParts(
      script,
      deriveSmsProtectedParts(script),
    )
    expect(masked).toBe('⟦1⟧, yes you ⟦2⟧. ⟦3⟧')
  })
})

describe('restoreProtectedParts', () => {
  it('puts the original text back when every marker returns in order', () => {
    const { locked } = maskedScript()
    const reply =
      "Hi ⟦1⟧! It's ⟦2⟧, and I'm running for city council. Please vote Nov 3.\n\n⟦3⟧. ⟦4⟧"
    expect(restoreProtectedParts(reply, locked)).toBe(
      "Hi {first_name}! It's Sarah Chen, and I'm running for city council. Please vote Nov 3.\n\nPaid for by Friends of Sarah Chen. Reply STOP to opt out.",
    )
  })

  it.each([
    ['drops a marker', 'Hi ⟦1⟧, ⟦2⟧ here. ⟦4⟧'],
    ['repeats a marker', 'Hi ⟦1⟧, ⟦2⟧ here. ⟦2⟧ ⟦3⟧. ⟦4⟧'],
    ['reorders markers', 'Hi ⟦1⟧, ⟦2⟧ here. ⟦4⟧ ⟦3⟧'],
    ['invents a marker', 'Hi ⟦1⟧, ⟦2⟧ here. ⟦3⟧. ⟦4⟧ ⟦5⟧'],
  ])('refuses a reply that %s', (_, reply) => {
    expect(restoreProtectedParts(reply, maskedScript().locked)).toBeNull()
  })
})
