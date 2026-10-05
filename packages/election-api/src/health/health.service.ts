import { Injectable } from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'
import { PinoLogger } from 'nestjs-pino'

/** How long a probe result is reused before another probe runs. */
export const HEALTH_PROBE_TTL_MS = 15_000
/** Probe budget. Must stay well under the ALB health-check timeout (5s). */
export const HEALTH_PROBE_TIMEOUT_MS = 2_000
/** How long we keep serving on a stale-but-successful probe while saturated. */
export const HEALTH_STALE_AFTER_MS = 120_000

/** Prisma's code for "Timed out fetching a new connection from the pool". */
const POOL_TIMEOUT_CODE = 'P2024'

class HealthProbeTimeoutError extends Error {
  constructor() {
    super(`health probe exceeded ${HEALTH_PROBE_TIMEOUT_MS}ms`)
    this.name = 'HealthProbeTimeoutError'
  }
}

/**
 * A probe failure that means "this task is busy", not "this task is broken".
 * Both shapes are the Prisma pool refusing to hand over a connection in time:
 * P2024 when Prisma's own pool_timeout expires first, our own timeout when the
 * probe outlives its budget.
 */
const isSaturationError = (e: unknown): boolean =>
  e instanceof HealthProbeTimeoutError ||
  (typeof e === 'object' &&
    e !== null &&
    'code' in e &&
    (e as { code?: unknown }).code === POOL_TIMEOUT_CODE)

/**
 * Liveness for the ALB target group. The load balancer gives GET /v1/health 5
 * seconds and ECS replaces the task after 3 consecutive failures, so what this
 * answers decides whether the task survives. Two rules follow from that.
 *
 * 1. Saturation is not death. When the service runs out of CPU, Prisma cannot
 *    cycle connections and every query — including this probe — waits out the
 *    pool timeout and fails with P2024. Answering "unhealthy" there makes ECS
 *    kill tasks in the middle of an overload, which removes capacity exactly
 *    when capacity is scarce and deepens the outage. That happened in prod on
 *    2026-10-05: two tasks replaced at 12:46 and 12:47 while the remaining
 *    tasks were already at 100% CPU. Postgres is reachable in that state; we
 *    are merely behind, and a busy task still serves. So a pool timeout keeps
 *    whatever the last probe concluded, for up to HEALTH_STALE_AFTER_MS.
 *
 * 2. The probe must not queue behind the flood it reports on. A verdict is
 *    reused for HEALTH_PROBE_TTL_MS and concurrent callers share one in-flight
 *    probe, so health checks cost one query every 15s per task however often
 *    the load balancer asks, and a probe never spends more than
 *    HEALTH_PROBE_TIMEOUT_MS of the balancer's 5 seconds.
 *
 * Everything else still reports unhealthy: a refused connection, bad
 * credentials, a dead host, or saturation that has lasted longer than
 * HEALTH_STALE_AFTER_MS without a single successful probe. A genuinely broken
 * task is still replaced.
 */
@Injectable()
export class HealthService {
  private lastHealthyAt = 0
  private cachedVerdict: boolean | null = null
  private cachedAt = 0
  private inFlight: Promise<boolean> | null = null

  constructor(
    private prisma: PrismaService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(HealthService.name)
  }

  async checkHealth(): Promise<boolean> {
    if (
      this.cachedVerdict !== null &&
      Date.now() - this.cachedAt < HEALTH_PROBE_TTL_MS
    ) {
      return this.cachedVerdict
    }

    this.inFlight ??= this.probe().finally(() => {
      this.inFlight = null
    })

    return this.inFlight
  }

  private async probe(): Promise<boolean> {
    let verdict: boolean

    try {
      await this.withTimeout(this.prisma.$queryRaw`SELECT 1`)
      this.lastHealthyAt = Date.now()
      verdict = true
    } catch (e: unknown) {
      if (isSaturationError(e)) {
        verdict = Date.now() - this.lastHealthyAt < HEALTH_STALE_AFTER_MS
        this.logger.warn(
          { err: e, healthy: verdict },
          'Health check could not get a connection; reporting load, not failure => ',
        )
      } else {
        this.logger.error({ err: e }, 'Health check failed => ')
        verdict = false
      }
    }

    this.cachedVerdict = verdict
    this.cachedAt = Date.now()

    return verdict
  }

  private async withTimeout<T>(work: PromiseLike<T>): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined

    try {
      return await Promise.race([
        work,
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(
            () => reject(new HealthProbeTimeoutError()),
            HEALTH_PROBE_TIMEOUT_MS,
          )
        }),
      ])
    } finally {
      if (timer) clearTimeout(timer)
    }
  }
}
