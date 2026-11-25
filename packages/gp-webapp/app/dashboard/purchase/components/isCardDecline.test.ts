import { describe, expect, it } from 'vitest'
import { isCardDecline } from './isCardDecline'

describe('isCardDecline', () => {
  it('treats the embedded checkout payment-failed code as a decline', () => {
    expect(
      isCardDecline({
        code: 'paymentFailed',
        paymentFailed: { declineCode: 'generic_decline' },
      }),
    ).toBe(true)
  })

  it('treats payment-failed with no issuer reason as a decline', () => {
    expect(
      isCardDecline({
        code: 'paymentFailed',
        paymentFailed: { declineCode: null },
      }),
    ).toBe(true)
  })

  it.each([
    'card_declined',
    'expired_card',
    'incorrect_cvc',
    'insufficient_funds',
    'authentication_failure',
  ])('treats the %s card code as a decline', (code) => {
    expect(isCardDecline({ code })).toBe(true)
  })

  it('treats any issuer decline code as a decline', () => {
    expect(
      isCardDecline({ code: 'card_error', decline_code: 'do_not_honor' }),
    ).toBe(true)
  })

  it('does not treat an integration failure as a decline', () => {
    expect(
      isCardDecline({
        code: 'api_error',
        message: 'An unknown error occurred.',
      }),
    ).toBe(false)
  })

  it('does not treat a failure with no Stripe code as a decline', () => {
    expect(
      isCardDecline({ message: 'Afterpay needs a billing address.' }),
    ).toBe(false)
  })
})
