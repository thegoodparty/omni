import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
} from '@nestjs/common'
import type { FastifyRequest } from 'fastify'

/**
 * In-memory per-IP token bucket for the public `POST /v1/person-profiles/claim-request`
 * endpoint.
 *
 * The endpoint is unauthenticated and writes a lead row on every call, so
 * without a limit a single caller could flood the `ProfileClaimRequest` table
 * (DB write-capacity exhaustion + infinite lead noise for the growth team).
 * This guard keeps a tiny token-bucket per remote IP, refusing requests beyond
 * the burst + refill window. Claim submissions are a rare, deliberate human
 * action, so the budget is deliberately tighter than the briefings share path.
 *
 * This is a *stopgap*, mirroring `BriefingsPdfRateLimitGuard`: the in-memory map
 * doesn't share across gp-api instances and `request.ip` is only meaningful when
 * fastify runs with `trustProxy` so the upstream LB's `X-Forwarded-For` is
 * respected. The long-term answer is edge (WAF) rate limiting on
 * `goodparty.org/api/v1/person-profiles/claim-request`.
 *
 * Memory bound (same strategy as the sibling guard): an IP-rotating attacker
 * would otherwise grow `buckets` indefinitely, so we (1) opportunistically sweep
 * idle, refilled buckets and (2) hard-evict the oldest once `MAX_BUCKETS` is
 * exceeded.
 */
@Injectable()
export class ProfileClaimRequestRateLimitGuard implements CanActivate {
  private readonly logger = new Logger(ProfileClaimRequestRateLimitGuard.name)

  // Token-bucket policy: a fresh IP starts with `capacity` tokens (burst budget)
  // and refills at `refillPerMs` tokens per millisecond.
  //   - capacity = 10  → up to 10 back-to-back submissions from a new IP.
  //   - refillPerMs = 10/60_000 → sustained 10 submissions / 60s.
  // Generous for a real person mistyping/retrying, but shuts down scripted
  // flooding of the leads table quickly.
  private readonly capacity = 10
  private readonly refillPerMs = 10 / 60_000

  // Memory-bound tunables. See class docstring for the strategy.
  private static readonly MAX_BUCKETS = 10_000
  private static readonly IDLE_TTL_MS = 5 * 60_000 // 5 min
  private static readonly SWEEP_INTERVAL_MS = 60_000 // 1 min
  private static readonly FORCED_EVICTION_FRACTION = 0.1

  private readonly buckets = new Map<
    string,
    { tokens: number; lastRefillMs: number }
  >()
  private lastSweepMs = 0

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<FastifyRequest>()
    const ip = (req.ip ?? 'unknown').toString()
    const now = Date.now()

    // Housekeeping before the per-IP work so transient spikes stay bounded.
    this.maybeSweep(now)

    const bucket = this.buckets.get(ip) ?? {
      tokens: this.capacity,
      lastRefillMs: now,
    }

    bucket.tokens = Math.min(
      this.capacity,
      bucket.tokens + (now - bucket.lastRefillMs) * this.refillPerMs,
    )
    bucket.lastRefillMs = now

    if (bucket.tokens < 1) {
      this.logger.warn(
        `Rate limit hit on POST /v1/person-profiles/claim-request from ${ip}; refusing further submissions until refill.`,
      )
      this.buckets.set(ip, bucket)
      throw new HttpException('Too Many Requests', HttpStatus.TOO_MANY_REQUESTS)
    }

    bucket.tokens -= 1
    this.buckets.set(ip, bucket)
    return true
  }

  private maybeSweep(now: number): void {
    if (
      now - this.lastSweepMs >=
      ProfileClaimRequestRateLimitGuard.SWEEP_INTERVAL_MS
    ) {
      this.lastSweepMs = now
      this.sweepIdleBuckets(now)
    }
    if (this.buckets.size > ProfileClaimRequestRateLimitGuard.MAX_BUCKETS) {
      this.forceEvictOldest()
    }
  }

  private sweepIdleBuckets(now: number): void {
    let removed = 0
    for (const [ip, bucket] of this.buckets) {
      if (
        now - bucket.lastRefillMs >=
        ProfileClaimRequestRateLimitGuard.IDLE_TTL_MS
      ) {
        this.buckets.delete(ip)
        removed++
      }
    }
    if (removed > 0) {
      this.logger.debug(
        `Claim-request rate-limit sweep removed ${removed} idle buckets (size now ${this.buckets.size}).`,
      )
    }
  }

  private forceEvictOldest(): void {
    const target = Math.floor(
      ProfileClaimRequestRateLimitGuard.MAX_BUCKETS *
        ProfileClaimRequestRateLimitGuard.FORCED_EVICTION_FRACTION,
    )
    const sorted = [...this.buckets.entries()].sort(
      (a, b) => a[1].lastRefillMs - b[1].lastRefillMs,
    )
    for (const [key] of sorted.slice(0, target)) {
      this.buckets.delete(key)
    }
    this.logger.warn(
      `Claim-request rate-limit cap hit: evicted ${target} oldest buckets (size now ${this.buckets.size}). ` +
        `Possible IP-rotation attack — review access logs.`,
    )
  }
}
