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
 * In-memory per-IP token bucket for the public
 * `/v1/magic-link/resolve/:slug` endpoint.
 *
 * The endpoint is unauthenticated and trades a 12-character slug for a live
 * Clerk sign-in ticket, so the obvious attack is spraying slug guesses. 72 bits
 * of entropy already makes that infeasible; this guard removes the throughput
 * to try at all, and caps the damage if the slug length is ever shortened.
 *
 * Limits are deliberately tighter than the campaign-plan-shares guard this is
 * modelled on: a lead follows their texted link once, plus the odd refresh, so
 * there is no legitimate burst to accommodate.
 *
 * Same stopgap caveats as the sibling guard: the map isn't shared across gp-api
 * instances, and `request.ip` is only meaningful when fastify runs with
 * `trustProxy` so the load balancer's `X-Forwarded-For` is honored. A WAF rule
 * on the route is the durable answer.
 *
 * Memory bound: an IP-rotating attacker would otherwise grow `buckets`
 * indefinitely. We mitigate via two complementary mechanisms:
 *   1. Opportunistic sweep — every `SWEEP_INTERVAL_MS` we drop any bucket that
 *      hasn't been touched in `IDLE_TTL_MS`.
 *   2. Hard ceiling — if the map exceeds `MAX_BUCKETS`, we forcibly evict the
 *      10% oldest by `lastRefillMs`.
 */
@Injectable()
export class MagicLinkResolveRateLimitGuard implements CanActivate {
  private readonly logger = new Logger(MagicLinkResolveRateLimitGuard.name)

  // Token-bucket policy: a fresh IP starts with `capacity` tokens (the burst
  // budget) and refills at `refillPerMs` tokens per millisecond.
  //   - capacity = 10  → up to 10 back-to-back resolves from a new IP.
  //   - refillPerMs = 10/60_000 → sustained 10 requests / 60s.
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

    // Run housekeeping before the per-IP work so transient memory spikes are
    // bounded even under bursty traffic.
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
        `Rate limit hit on /v1/magic-link/resolve/:slug from ${ip}; refusing further requests until refill.`,
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
      MagicLinkResolveRateLimitGuard.SWEEP_INTERVAL_MS
    ) {
      this.lastSweepMs = now
      this.sweepIdleBuckets(now)
    }
    if (this.buckets.size > MagicLinkResolveRateLimitGuard.MAX_BUCKETS) {
      this.forceEvictOldest()
    }
  }

  /**
   * Drop any bucket that hasn't been touched in `IDLE_TTL_MS`. Given the refill
   * rate (full capacity in 60s) and the idle TTL (5 min), an idle bucket has
   * unconditionally refilled to full long before being swept, so the next
   * request from that IP starts in the same state either way.
   */
  private sweepIdleBuckets(now: number): void {
    let removed = 0
    for (const [ip, bucket] of this.buckets) {
      if (
        now - bucket.lastRefillMs >=
        MagicLinkResolveRateLimitGuard.IDLE_TTL_MS
      ) {
        this.buckets.delete(ip)
        removed++
      }
    }
    if (removed > 0) {
      this.logger.debug(
        `Rate-limit sweep removed ${removed} idle buckets (size now ${this.buckets.size}).`,
      )
    }
  }

  /**
   * Emergency cap: if an attacker rotates IPs fast enough to exceed
   * `MAX_BUCKETS`, drop the oldest `FORCED_EVICTION_FRACTION` of entries to
   * free space. Dropped clients start over with a fresh bucket — a soft reset
   * rather than a permission, since legitimate users never reach this branch.
   */
  private forceEvictOldest(): void {
    const target = Math.floor(
      MagicLinkResolveRateLimitGuard.MAX_BUCKETS *
        MagicLinkResolveRateLimitGuard.FORCED_EVICTION_FRACTION,
    )
    const sorted = [...this.buckets.entries()].sort(
      (a, b) => a[1].lastRefillMs - b[1].lastRefillMs,
    )
    for (const [ip] of sorted.slice(0, target)) {
      this.buckets.delete(ip)
    }
    this.logger.warn(
      `Rate-limit cap hit: evicted ${target} oldest buckets (size now ${this.buckets.size}). ` +
        `Possible IP-rotation attack — review access logs.`,
    )
  }
}
