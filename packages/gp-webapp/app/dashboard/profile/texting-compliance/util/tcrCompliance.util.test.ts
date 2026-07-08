import { describe, it, expect } from 'vitest'
import { describePinDelivery } from './tcrCompliance.util'

describe('describePinDelivery', () => {
  it('describes an email delivery with a masked address', () => {
    expect(
      describePinDelivery({
        method: 'email',
        destination: 'lindsey@gmail.com',
      }),
    ).toBe('We sent your PIN by email to l•••@gmail.com.')
  })

  it('describes a text delivery with a masked phone number', () => {
    expect(
      describePinDelivery({ method: 'text', destination: '3126851162' }),
    ).toBe('We sent your PIN by text to (312) •••-1162.')
  })

  it('describes phone and call deliveries as a phone call', () => {
    expect(
      describePinDelivery({ method: 'phone', destination: '3126851162' }),
    ).toBe('We sent your PIN by phone to (312) •••-1162.')
    expect(
      describePinDelivery({ method: 'call', destination: '3126851162' }),
    ).toBe('We sent your PIN by phone to (312) •••-1162.')
  })

  it('describes a mail delivery with the address as-is', () => {
    expect(
      describePinDelivery({
        method: 'mail',
        destination: '1221 Glengary Way, Henderson, KY 42420',
      }),
    ).toBe('We mailed your PIN to 1221 Glengary Way, Henderson, KY 42420.')
  })

  it('returns null when there is no delivery to describe', () => {
    expect(describePinDelivery(null)).toBeNull()
    expect(describePinDelivery(undefined)).toBeNull()
  })
})
