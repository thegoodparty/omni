import { describe, it, expect } from 'vitest'
import { describePinDelivery } from './tcrCompliance.util'

describe('describePinDelivery', () => {
  it('composes the sentence from the pre-masked display string', () => {
    expect(
      describePinDelivery({ method: 'email', displayString: 'l•••@gmail.com' }),
    ).toBe('We sent your PIN by email to l•••@gmail.com.')
    expect(
      describePinDelivery({ method: 'text', displayString: '(312) •••-1162' }),
    ).toBe('We sent your PIN by text to (312) •••-1162.')
  })

  it('describes phone and call deliveries as a phone call', () => {
    expect(
      describePinDelivery({ method: 'phone', displayString: '(312) •••-1162' }),
    ).toBe('We sent your PIN by phone to (312) •••-1162.')
    expect(
      describePinDelivery({ method: 'call', displayString: '(312) •••-1162' }),
    ).toBe('We sent your PIN by phone to (312) •••-1162.')
  })

  it('describes a mail delivery from the masked display string', () => {
    expect(
      describePinDelivery({
        method: 'mail',
        displayString: 'your address on file',
      }),
    ).toBe('We mailed your PIN to your address on file.')
  })

  it('returns null when there is no delivery to describe', () => {
    expect(describePinDelivery(null)).toBeNull()
    expect(describePinDelivery(undefined)).toBeNull()
  })
})
