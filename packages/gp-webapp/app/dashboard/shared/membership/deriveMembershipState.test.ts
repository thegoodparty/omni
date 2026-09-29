import { describe, it, expect } from 'vitest'
import { PeerlyCvVerificationStatus } from '@goodparty_org/contracts'
import { deriveMembershipState } from './deriveMembershipState'

const base = {
  isPro: false,
  isElectedOffice: false,
  tcrStatus: null,
  hasPeerlyIdentity: false,
  peerlyCvStatus: null,
  pinDelivery: null,
}

describe('deriveMembershipState', () => {
  it('is free and needs verification with no Pro and no TCR record', () => {
    expect(deriveMembershipState(base)).toEqual({
      tier: 'free',
      texting: 'needs_verification',
      pinDelivery: null,
      isElectedOffice: false,
    })
  })

  it('treats an elected office as pro without isPro', () => {
    const state = deriveMembershipState({ ...base, isElectedOffice: true })
    expect(state.tier).toBe('pro')
    expect(state.isElectedOffice).toBe(true)
  })

  it('needs verification for error and rejected records', () => {
    expect(
      deriveMembershipState({ ...base, isPro: true, tcrStatus: 'error' })
        .texting,
    ).toBe('needs_verification')
    expect(
      deriveMembershipState({ ...base, isPro: true, tcrStatus: 'rejected' })
        .texting,
    ).toBe('needs_verification')
  })

  it('is in review while submitted without a Peerly identity', () => {
    expect(
      deriveMembershipState({ ...base, isPro: true, tcrStatus: 'submitted' })
        .texting,
    ).toBe('in_review')
  })

  it('is in review while submitted and the CV request is not approved', () => {
    expect(
      deriveMembershipState({
        ...base,
        isPro: true,
        tcrStatus: 'submitted',
        hasPeerlyIdentity: true,
        peerlyCvStatus: PeerlyCvVerificationStatus.IN_REVIEW,
      }).texting,
    ).toBe('in_review')
  })

  it('is awaiting a PIN once the CV request is approved, carrying the delivery', () => {
    const pinDelivery = {
      method: 'email',
      displayString: 'l•••@x.com',
    } as const
    const state = deriveMembershipState({
      ...base,
      isPro: true,
      tcrStatus: 'submitted',
      hasPeerlyIdentity: true,
      peerlyCvStatus: PeerlyCvVerificationStatus.APPROVED,
      pinDelivery,
    })
    expect(state.texting).toBe('awaiting_pin')
    expect(state.pinDelivery).toEqual(pinDelivery)
  })

  it('is in review after the PIN is entered (pending 10DLC)', () => {
    expect(
      deriveMembershipState({ ...base, isPro: true, tcrStatus: 'pending' })
        .texting,
    ).toBe('in_review')
  })

  it('is cleared when approved', () => {
    expect(
      deriveMembershipState({ ...base, isPro: true, tcrStatus: 'approved' })
        .texting,
    ).toBe('cleared')
  })
})
