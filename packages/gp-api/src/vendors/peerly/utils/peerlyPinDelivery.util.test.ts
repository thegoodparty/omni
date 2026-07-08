import { describe, expect, it } from 'vitest'
import { derivePinDelivery } from './peerlyPinDelivery.util'

describe('derivePinDelivery', () => {
  it('maps email to the filing email', () => {
    expect(
      derivePinDelivery({
        verification_method: 'email',
        filing_email: 'candidate@example.com',
        filing_phone_number: '2565551212',
      }),
    ).toEqual({ method: 'email', destination: 'candidate@example.com' })
  })

  it('maps text/phone/call to the filing phone number', () => {
    for (const method of ['text', 'phone', 'call']) {
      expect(
        derivePinDelivery({
          verification_method: method,
          filing_email: 'candidate@example.com',
          filing_phone_number: '2565551212',
        }),
      ).toEqual({ method, destination: '2565551212' })
    }
  })

  it('maps mail to the formatted filing address', () => {
    expect(
      derivePinDelivery({
        verification_method: 'mail',
        filing_address_line1: '1234 State Street',
        filing_city: 'Madison',
        filing_state: 'AL',
        filing_zip: '35802',
      }),
    ).toEqual({
      method: 'mail',
      destination: '1234 State Street, Madison, AL, 35802',
    })
  })

  it('is case-insensitive on the method', () => {
    expect(
      derivePinDelivery({
        verification_method: 'TEXT',
        filing_phone_number: '2565551212',
      }),
    ).toEqual({ method: 'text', destination: '2565551212' })
  })

  it('returns null when no method is present (PIN not sent yet)', () => {
    expect(derivePinDelivery({ filing_email: 'a@b.com' })).toBeNull()
    expect(derivePinDelivery(null)).toBeNull()
    expect(derivePinDelivery(undefined)).toBeNull()
  })

  it('returns null for an unrecognized method', () => {
    expect(
      derivePinDelivery({
        verification_method: 'carrier_pigeon',
        filing_email: 'a@b.com',
      }),
    ).toBeNull()
  })

  it('returns null when the matching destination field is empty', () => {
    expect(
      derivePinDelivery({ verification_method: 'email', filing_email: '' }),
    ).toBeNull()
    expect(
      derivePinDelivery({
        verification_method: 'text',
        filing_phone_number: '   ',
      }),
    ).toBeNull()
    expect(
      derivePinDelivery({
        verification_method: 'mail',
        filing_city: 'Madison',
      }),
    ).toBeNull()
  })
})
