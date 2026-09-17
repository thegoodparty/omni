import { ExecutionContext, HttpException } from '@nestjs/common'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MagicLinkResolveRateLimitGuard } from './magicLinkResolveRateLimit.guard'

/**
 * Same in-memory token bucket as CampaignPlanSharesRateLimitGuard, and these
 * tests are its siblings — but the numbers are a third of it (capacity 10,
 * 10/60s) because of what sits behind this endpoint. `magic-link/resolve/:slug`
 * trades a 12-character slug for a URL carrying a live single-use sign-in
 * ticket, so the budget is also a guess-rate ceiling, not only a cost control.
 *
 * Worth testing directly rather than through the controller: the controller
 * tests call `MagicLinkController.resolve` via `app.get(...)`, which bypasses
 * NestJS guards entirely, so none of this runs there.
 */

function ctxForIp(ip: string): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => ({ ip }),
    }),
  } as unknown as ExecutionContext
}

const bucketsOf = (guard: MagicLinkResolveRateLimitGuard) =>
  (
    guard as unknown as {
      buckets: Map<string, { tokens: number; lastRefillMs: number }>
    }
  ).buckets

describe('MagicLinkResolveRateLimitGuard', () => {
  let guard: MagicLinkResolveRateLimitGuard

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-17T20:00:00Z'))
    guard = new MagicLinkResolveRateLimitGuard()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('allows requests within the burst capacity', () => {
    for (let i = 0; i < 10; i++) {
      expect(guard.canActivate(ctxForIp('1.2.3.4'))).toBe(true)
    }
  })

  it('refuses the next request after burst is exhausted', () => {
    for (let i = 0; i < 10; i++) {
      guard.canActivate(ctxForIp('1.2.3.4'))
    }
    expect(() => guard.canActivate(ctxForIp('1.2.3.4'))).toThrow(HttpException)
  })

  it('refills tokens over time', () => {
    for (let i = 0; i < 10; i++) {
      guard.canActivate(ctxForIp('1.2.3.4'))
    }
    // 10 tokens per 60s, so a full minute restores the whole burst budget.
    vi.advanceTimersByTime(60_000)
    expect(guard.canActivate(ctxForIp('1.2.3.4'))).toBe(true)
  })

  // The refill is continuous rather than a window that resets, which is what
  // keeps a blocked client from getting its whole budget back on a clock tick.
  it('refills proportionally, not all at once', () => {
    for (let i = 0; i < 10; i++) {
      guard.canActivate(ctxForIp('1.2.3.4'))
    }
    // 6s buys one token: spend it, and the next request is refused again.
    vi.advanceTimersByTime(6_000)
    expect(guard.canActivate(ctxForIp('1.2.3.4'))).toBe(true)
    expect(() => guard.canActivate(ctxForIp('1.2.3.4'))).toThrow(HttpException)
  })

  // One lead clicking a texted link must not be refused because someone else
  // is brute-forcing slugs.
  it('tracks buckets per-IP independently', () => {
    for (let i = 0; i < 10; i++) guard.canActivate(ctxForIp('a'))
    expect(() => guard.canActivate(ctxForIp('a'))).toThrow(HttpException)
    expect(guard.canActivate(ctxForIp('b'))).toBe(true)
  })

  it('sweeps idle full buckets after the idle TTL', () => {
    guard.canActivate(ctxForIp('first'))
    // Past both the idle TTL (5 min) and the sweep interval (1 min), so the
    // sweep runs on the next call and reclaims a bucket that has refilled.
    vi.advanceTimersByTime(6 * 60_000)
    guard.canActivate(ctxForIp('second'))

    const buckets = bucketsOf(guard)
    expect(buckets.has('first')).toBe(false)
    expect(buckets.has('second')).toBe(true)
  })

  // A bucket mid-refill is still rate-limiting someone, so the sweep must not
  // reclaim it — doing so would hand a rotating attacker a fresh burst budget
  // every time the sweep ran.
  it('keeps a partly-spent bucket that the idle TTL has passed over', () => {
    for (let i = 0; i < 10; i++) guard.canActivate(ctxForIp('spender'))
    // Long enough to be idle, but only enough refill for 1 of 10 tokens.
    vi.advanceTimersByTime(6_000)
    guard.canActivate(ctxForIp('other'))

    expect(bucketsOf(guard).has('spender')).toBe(true)
  })

  it('caps total bucket count under heavy IP rotation', () => {
    // The ceiling is 10,000 with a 10% forced-eviction step, so 12,000 distinct
    // IPs must not grow the map past it.
    for (let i = 0; i < 12_000; i++) {
      guard.canActivate(ctxForIp(`ip-${i}`))
    }
    expect(bucketsOf(guard).size).toBeLessThanOrEqual(10_000)
  })
})
