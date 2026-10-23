import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
} from '@nestjs/common'
import type { FastifyRequest } from 'fastify'

/**
 * In-memory per-IP token bucket for the public civic panel join
 * (`POST /v1/civic-panel/join/:code`). Anyone can reach it, and each call
 * reads the voter mart to match the phone, so a caller gets a few joins and
 * then about one a minute. Per process, like `OnboardingStatsRateLimitGuard`,
 * whose memory bound this copies; the IP is never logged.
 */
@Injectable()
export class CivicPanelJoinRateLimitGuard implements CanActivate {
  private readonly capacity = 5
  private readonly refillPerMs = 1 / 60_000

  private static readonly MAX_BUCKETS = 10_000
  private static readonly IDLE_TTL_MS = 10 * 60_000
  private static readonly SWEEP_INTERVAL_MS = 60_000
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
    this.buckets.set(ip, bucket)

    if (bucket.tokens < 1) {
      throw new HttpException('Too Many Requests', HttpStatus.TOO_MANY_REQUESTS)
    }
    bucket.tokens -= 1
    return true
  }

  private maybeSweep(now: number): void {
    const guard = CivicPanelJoinRateLimitGuard
    if (now - this.lastSweepMs >= guard.SWEEP_INTERVAL_MS) {
      this.lastSweepMs = now
      for (const [ip, bucket] of this.buckets) {
        if (now - bucket.lastRefillMs >= guard.IDLE_TTL_MS) {
          this.buckets.delete(ip)
        }
      }
    }
    if (this.buckets.size > guard.MAX_BUCKETS) {
      const target = Math.floor(
        guard.MAX_BUCKETS * guard.FORCED_EVICTION_FRACTION,
      )
      const oldest = [...this.buckets.entries()]
        .sort((a, b) => a[1].lastRefillMs - b[1].lastRefillMs)
        .slice(0, target)
      for (const [key] of oldest) this.buckets.delete(key)
    }
  }
}
