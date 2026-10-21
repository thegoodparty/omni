import { ExecutionContext, HttpException } from '@nestjs/common'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { OnboardingStatsRateLimitGuard } from './onboardingStatsRateLimit.guard'

const ctxForIp = (ip: string): ExecutionContext =>
  ({
    switchToHttp: () => ({
      getRequest: () => ({ ip }),
    }),
  }) as unknown as ExecutionContext

describe('OnboardingStatsRateLimitGuard', () => {
  let guard: OnboardingStatsRateLimitGuard

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-25T20:00:00Z'))
    guard = new OnboardingStatsRateLimitGuard()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('allows requests within the burst capacity', () => {
    for (let i = 0; i < 30; i++) {
      expect(guard.canActivate(ctxForIp('1.2.3.4'))).toBe(true)
    }
  })

  it('refuses the next request after burst is exhausted', () => {
    for (let i = 0; i < 30; i++) {
      guard.canActivate(ctxForIp('1.2.3.4'))
    }
    expect(() => guard.canActivate(ctxForIp('1.2.3.4'))).toThrow(HttpException)
  })

  it('refills tokens over time', () => {
    for (let i = 0; i < 30; i++) {
      guard.canActivate(ctxForIp('1.2.3.4'))
    }
    vi.advanceTimersByTime(60_000)
    expect(guard.canActivate(ctxForIp('1.2.3.4'))).toBe(true)
  })

  it('tracks buckets per-IP independently', () => {
    for (let i = 0; i < 30; i++) guard.canActivate(ctxForIp('a'))
    expect(() => guard.canActivate(ctxForIp('a'))).toThrow(HttpException)
    expect(guard.canActivate(ctxForIp('b'))).toBe(true)
  })

  it('sweeps idle full buckets after the idle TTL', () => {
    guard.canActivate(ctxForIp('first'))
    vi.advanceTimersByTime(6 * 60_000)
    guard.canActivate(ctxForIp('second'))

    const buckets = (
      guard as unknown as {
        buckets: Map<string, { tokens: number; lastRefillMs: number }>
      }
    ).buckets
    expect(buckets.has('first')).toBe(false)
    expect(buckets.has('second')).toBe(true)
  })

  it('caps total bucket count under heavy IP rotation', () => {
    for (let i = 0; i < 12_000; i++) {
      guard.canActivate(ctxForIp(`ip-${i}`))
    }
    const buckets = (
      guard as unknown as {
        buckets: Map<string, { tokens: number; lastRefillMs: number }>
      }
    ).buckets
    expect(buckets.size).toBeLessThanOrEqual(10_000)
  })
})
