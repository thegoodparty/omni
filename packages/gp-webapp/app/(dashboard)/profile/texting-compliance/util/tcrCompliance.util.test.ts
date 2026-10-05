import { describe, it, expect } from 'vitest'
import { PeerlyCvVerificationStatus } from '@goodparty_org/contracts'
import type { TcrCompliance } from 'helpers/types'
import { describePinDelivery, isTcrCleared } from './tcrCompliance.util'

const buildTcrCompliance = (
  overrides: Partial<TcrCompliance>,
): TcrCompliance => ({
  id: 'tcr-1',
  ein: '12-3456789',
  postalAddress: '1 Main St, Springfield, IL 62701',
  committeeName: 'Friends of Test',
  websiteDomain: 'https://example.com',
  filingUrl: 'https://elections.il.gov/filing/1',
  phone: '3125551162',
  email: 'candidate@example.com',
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
  campaignId: 1,
  ...overrides,
})

describe('isTcrCleared', () => {
  it('treats an approved record as cleared even when the persisted CV status was never stamped', () => {
    // Records approved before the CV status scan existed carry a null
    // peerlyCvStatus forever — approval itself proves the PIN was verified.
    expect(
      isTcrCleared(
        buildTcrCompliance({ status: 'approved', peerlyCvStatus: null }),
      ),
    ).toBe(true)
  })

  it('treats a VERIFIED CV as cleared before the record reaches approved', () => {
    expect(
      isTcrCleared(
        buildTcrCompliance({
          status: 'pending',
          peerlyCvStatus: PeerlyCvVerificationStatus.VERIFIED,
        }),
      ),
    ).toBe(true)
  })

  it('is not cleared while verification is still pending', () => {
    expect(
      isTcrCleared(
        buildTcrCompliance({ status: 'submitted', peerlyCvStatus: null }),
      ),
    ).toBe(false)
    expect(
      isTcrCleared(
        buildTcrCompliance({
          status: 'submitted',
          peerlyCvStatus: PeerlyCvVerificationStatus.APPROVED,
        }),
      ),
    ).toBe(false)
  })

  it('is not cleared without a compliance record', () => {
    expect(isTcrCleared(null)).toBe(false)
    expect(isTcrCleared(undefined)).toBe(false)
  })
})

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
