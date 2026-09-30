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
 * In-memory per-IP token bucket for the public `/v1/elections/*` reads.
 *
 * All four routes take caller-supplied parameters and answer them out of
 * election-api, so the cost of the route is an upstream query the caller
 * shapes. The budget is sized for onboarding, which walks a user through
 * state, district type and district name pickers in quick succession:
 *   - capacity = 60 → up to 60 back-to-back reads from a fresh IP.
 *   - refillPerMs = 60/60_000 → sustained 60 reads / 60s.
 *
 * The limit is per process and therefore per replica: the map is not shared
 * across gp-api instances, and `request.ip` is only the real client when
 * fastify runs with `trustProxy` so the upstream load balancer's
 * `X-Forwarded-For` is honoured. The real answer is an edge (WAF) rate limit
 * on `goodparty.org/api/v1/elections/*`; this guard is the stopgap until that
 * lands, mirroring `BriefingsPdfRateLimitGuard`.
 *
 * Memory bound (same strategy as the sibling guards): a caller that rotates
 * IPs would otherwise grow `buckets` without limit, so we (1) opportunistically
 * sweep idle, refilled buckets and (2) hard-evict the oldest once
 * `MAX_BUCKETS` is exceeded.
 */
@Injectable()
export class ElectionsRateLimitGuard implements CanActivate {
  private readonly logger = new Logger(ElectionsRateLimitGuard.name)

  private readonly capacity = 60
  private readonly refillPerMs = 60 / 60_000

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
        `Rate limit hit on /v1/elections from ${ip}; refusing further reads until refill.`,
      )
      this.buckets.set(ip, bucket)
      throw new HttpException('Too Many Requests', HttpStatus.TOO_MANY_REQUESTS)
    }

    bucket.tokens -= 1
    this.buckets.set(ip, bucket)
    return true
  }

  private maybeSweep(now: number): void {
    if (now - this.lastSweepMs >= ElectionsRateLimitGuard.SWEEP_INTERVAL_MS) {
      this.lastSweepMs = now
      this.sweepIdleBuckets(now)
    }
    if (this.buckets.size > ElectionsRateLimitGuard.MAX_BUCKETS) {
      this.forceEvictOldest()
    }
  }

  private sweepIdleBuckets(now: number): void {
    let removed = 0
    for (const [ip, bucket] of this.buckets) {
      if (now - bucket.lastRefillMs >= ElectionsRateLimitGuard.IDLE_TTL_MS) {
        this.buckets.delete(ip)
        removed++
      }
    }
    if (removed > 0) {
      this.logger.debug(
        `Elections rate-limit sweep removed ${removed} idle buckets (size now ${this.buckets.size}).`,
      )
    }
  }

  private forceEvictOldest(): void {
    const target = Math.floor(
      ElectionsRateLimitGuard.MAX_BUCKETS *
        ElectionsRateLimitGuard.FORCED_EVICTION_FRACTION,
    )
    const sorted = [...this.buckets.entries()].sort(
      (a, b) => a[1].lastRefillMs - b[1].lastRefillMs,
    )
    for (const [key] of sorted.slice(0, target)) {
      this.buckets.delete(key)
    }
    this.logger.warn(
      `Elections rate-limit cap hit: evicted ${target} oldest buckets (size now ${this.buckets.size}). ` +
        `Review access logs for IP rotation.`,
    )
  }
}
