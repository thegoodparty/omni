import { describe, expect, it } from 'vitest'
import {
  resolveSendingNumber,
  sendingNumberByOrganizationSlug,
  sendingNumberByState,
  tollFreeFallback,
} from './sendingNumbers.config'

const DEARBORN = 'eo-019a7e76-c70b-73a1-ae4b-8b3e2f2cd851'

describe('resolveSendingNumber', () => {
  it('uses the organization override before the state default', () => {
    expect(
      resolveSendingNumber({ organizationSlug: DEARBORN, state: 'MI' }),
    ).toBe('+13132038028')
  })

  it("uses the state's default when the organization has no override", () => {
    expect(
      resolveSendingNumber({ organizationSlug: 'eo-other', state: 'MI' }),
    ).toBe('+15172256295')
  })

  it('falls back to toll-free for a state with no 10DLC number', () => {
    expect(
      resolveSendingNumber({ organizationSlug: 'eo-other', state: 'NY' }),
    ).toBe(tollFreeFallback)
  })

  it('falls back to toll-free when the state is unknown', () => {
    expect(
      resolveSendingNumber({ organizationSlug: 'eo-other', state: null }),
    ).toBe(tollFreeFallback)
  })
})

describe('sending number config', () => {
  it('holds only +1 E.164 numbers', () => {
    const numbers = [
      ...Object.values(sendingNumberByState),
      ...Object.values(sendingNumberByOrganizationSlug),
      tollFreeFallback,
    ]
    for (const number of numbers) {
      expect(number).toMatch(/^\+1\d{10}$/)
    }
  })

  it('keys states by their two-letter code', () => {
    for (const state of Object.keys(sendingNumberByState)) {
      expect(state).toMatch(/^[A-Z]{2}$/)
    }
  })
})
