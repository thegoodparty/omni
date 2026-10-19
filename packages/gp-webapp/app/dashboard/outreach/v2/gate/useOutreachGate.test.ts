import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import type { MembershipState } from 'app/dashboard/shared/membership/deriveMembershipState'
import { useMembershipState } from 'app/dashboard/shared/membership/useMembershipState'
import { useOutreachGate } from './useOutreachGate'

vi.mock('app/dashboard/shared/membership/useMembershipState', () => ({
  useMembershipState: vi.fn(),
}))

const mockUseMembershipState = vi.mocked(useMembershipState)

const baseMembership: MembershipState = {
  tier: 'free',
  texting: 'needs_verification',
  pinDelivery: null,
  isElectedOffice: false,
}

const setMembership = (state: MembershipState | null, ready = true): void => {
  mockUseMembershipState.mockReturnValue({
    ready,
    state,
    tcrCompliance: null,
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  setMembership(baseMembership)
})

describe('useOutreachGate', () => {
  it('is disabled while membership is not ready', () => {
    setMembership(null, false)

    const { result } = renderHook(() => useOutreachGate('sms'))

    expect(result.current.enabled).toBe(false)
    expect(result.current.requirement).toBeNull()
  })

  it('is never gated for a Serve (elected office) org', () => {
    setMembership({ ...baseMembership, tier: 'pro', isElectedOffice: true })

    const { result } = renderHook(() => useOutreachGate('sms'))

    expect(result.current.enabled).toBe(true)
    expect(result.current.requirement).toBeNull()
  })

  it('requires Pro for a free-tier campaign', () => {
    const { result } = renderHook(() => useOutreachGate('sms'))

    expect(result.current.requirement).toBe('pro')
  })

  it('requires nothing for a Pro campaign on a non-texting channel', () => {
    setMembership({ ...baseMembership, tier: 'pro' })

    const { result } = renderHook(() => useOutreachGate('robocall'))

    expect(result.current.requirement).toBeNull()
  })

  it('requires verification for a Pro campaign that needs it, texting only', () => {
    setMembership({ ...baseMembership, tier: 'pro' })

    expect(
      renderHook(() => useOutreachGate('sms')).result.current.requirement,
    ).toBe('verify')
    expect(
      renderHook(() => useOutreachGate('door')).result.current.requirement,
    ).toBeNull()
  })

  it('requires in_review for a Pro campaign whose verification is in review', () => {
    setMembership({ ...baseMembership, tier: 'pro', texting: 'in_review' })

    const { result } = renderHook(() => useOutreachGate('sms'))

    expect(result.current.requirement).toBe('in_review')
  })

  it('requires pin for a Pro campaign awaiting a PIN', () => {
    setMembership({ ...baseMembership, tier: 'pro', texting: 'awaiting_pin' })

    const { result } = renderHook(() => useOutreachGate('sms'))

    expect(result.current.requirement).toBe('pin')
  })

  it('returns closed for sms ahead of the Pro requirement', () => {
    setMembership({ ...baseMembership, tier: 'free', texting: 'closed' })

    expect(
      renderHook(() => useOutreachGate('sms')).result.current.requirement,
    ).toBe('closed')
    expect(
      renderHook(() => useOutreachGate('robocall')).result.current.requirement,
    ).toBe('pro')
  })

  it('returns closed for a Pro campaign on sms only', () => {
    setMembership({ ...baseMembership, tier: 'pro', texting: 'closed' })

    expect(
      renderHook(() => useOutreachGate('sms')).result.current.requirement,
    ).toBe('closed')
    expect(
      renderHook(() => useOutreachGate('door')).result.current.requirement,
    ).toBeNull()
  })

  it('never closes texting for a Serve (elected office) org', () => {
    setMembership({
      ...baseMembership,
      tier: 'pro',
      texting: 'closed',
      isElectedOffice: true,
    })

    expect(
      renderHook(() => useOutreachGate('sms')).result.current.requirement,
    ).toBeNull()
  })

  it('requires nothing once texting is cleared', () => {
    setMembership({ ...baseMembership, tier: 'pro', texting: 'cleared' })

    const { result } = renderHook(() => useOutreachGate('sms'))

    expect(result.current.requirement).toBeNull()
  })

  it('sets twoStep only for sms, regardless of requirement', () => {
    expect(
      renderHook(() => useOutreachGate('sms')).result.current.twoStep,
    ).toBe(true)
    expect(
      renderHook(() => useOutreachGate('robocall')).result.current.twoStep,
    ).toBe(false)
    expect(
      renderHook(() => useOutreachGate('door')).result.current.twoStep,
    ).toBe(false)
    expect(
      renderHook(() => useOutreachGate('phone-bank')).result.current.twoStep,
    ).toBe(false)
  })

  it('passes membership and tcrCompliance through when enabled', () => {
    const tcrCompliance = { status: 'submitted', peerlyIdentityId: 'p-1' }
    mockUseMembershipState.mockReturnValue({
      ready: true,
      state: baseMembership,
      // @ts-expect-error partial fixture, only the fields the hook reads matter
      tcrCompliance,
    })

    const { result } = renderHook(() => useOutreachGate('sms'))

    expect(result.current.membership).toEqual(baseMembership)
    expect(result.current.tcrCompliance).toEqual(tcrCompliance)
  })
})
