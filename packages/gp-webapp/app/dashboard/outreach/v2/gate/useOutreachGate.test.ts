import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import type { MembershipState } from 'app/dashboard/shared/membership/deriveMembershipState'
import { useOutreachProGatingV2Flag } from 'app/shared/experiments/outreachProGatingV2Flag'
import { useMembershipState } from 'app/dashboard/shared/membership/useMembershipState'
import { useOutreachGate } from './useOutreachGate'

vi.mock('app/shared/experiments/outreachProGatingV2Flag', () => ({
  useOutreachProGatingV2Flag: vi.fn(),
}))
vi.mock('app/dashboard/shared/membership/useMembershipState', () => ({
  useMembershipState: vi.fn(),
}))

const mockUseFlag = vi.mocked(useOutreachProGatingV2Flag)
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
  mockUseFlag.mockReturnValue({ ready: true, enabled: true })
  setMembership(baseMembership)
})

describe('useOutreachGate', () => {
  it('is disabled when the flag is off', () => {
    mockUseFlag.mockReturnValue({ ready: true, enabled: false })

    const { result } = renderHook(() => useOutreachGate('sms'))

    expect(result.current.enabled).toBe(false)
    expect(result.current.requirement).toBeNull()
  })

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

  it('threads flagEnabled into useMembershipState as its own enabled option', () => {
    mockUseFlag.mockReturnValue({ ready: true, enabled: false })

    renderHook(() => useOutreachGate('sms'))

    expect(mockUseMembershipState).toHaveBeenCalledWith({ enabled: false })
  })
})
