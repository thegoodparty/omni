import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
  ServiceUnavailableException,
} from '@nestjs/common'
import { FastifyRequest } from 'fastify'
import { Observable } from 'rxjs'
import { finalize } from 'rxjs/operators'
import { Semaphore, SemaphoreTimeoutError } from '../util/semaphore'

/**
 * Admission control for the unpaginated whole-table list reads.
 *
 * WHY THIS EXISTS. `GET /v1/persons`, `/v1/officeholders` and `/v1/candidacies`
 * return a whole state in one array — there is no pagination and no row cap,
 * because the caller building the public /people sitemaps needs the complete
 * set. Measured in prod: `?state=PA` on officeholders is 6.9 MB and 8.2 s,
 * `?state=IL` on persons is 3.4 MB and 8.5 s. Each one holds one of the task's
 * 25 Prisma connections (`PRISMA_CONNECTION_LIMIT`) for its whole duration.
 *
 * The sitemap sweep walks all 51 state codes on each of three feeds, 8 states in
 * flight at a time, and it is re-run per sitemap shard. Measured on 2026-09-29
 * in a healthy ten-second window: 44 DISTINCT whole-state reads in flight,
 * holding about 33 of the 50 connections the two prod tasks own between them.
 * On 2026-09-25 the same workload took all of them, and for three minutes every
 * other read — including the voter-density heat map on public profile pages —
 * queued, waited out the 20-second acquire timeout and failed with Prisma
 * `P2024`. 825 visitors got a 502 instead of a map.
 *
 * COALESCING WAS NOT ENOUGH, and that is the point of this file. Sharing one
 * query between *identical* concurrent reads removes the duplicate copies, which
 * is what turned the 2026-09-25 sweep into an outage (8.2 identical copies per
 * URL in the minute it broke). It does nothing about 51 *different* states asked
 * for at the same time, and the measurement above says that alone already
 * accounts for about two thirds of the pool.
 *
 * SO THE BOUND IS ON THE WORKLOAD, NOT ON THE POOL. Raising
 * `PRISMA_CONNECTION_LIMIT` moves the wall — a wider sweep, or one more
 * concurrent sitemap render, refills a bigger pool just as completely — and it
 * needs a number nobody here can check, because Aurora's `max_connections` is
 * not readable from the application. Capping how many of these reads may be in
 * flight at once bounds it instead: whatever the caller does, a fixed slice of
 * every task's pool is left for the requests a person is waiting on.
 *
 * WHAT IT DELIBERATELY DOES NOT COVER. It is bound per handler, on the three
 * list routes only. `GET /v1/persons/:id/voter-density` and every other point
 * read are the things being protected; throttling them would be the opposite of
 * the point. A list request that names a single entity is let through untouched
 * for the same reason — see `isBulkRead`.
 *
 * THE COST, stated plainly: during a sweep the sitemap's own reads get slower,
 * because the ninth concurrent one waits for the eighth to finish. At 8 permits
 * and ~10 s a read, a 44-deep burst drains in under a minute. If it cannot get a
 * permit inside {@link BULK_WAIT_MS} the request is refused with a 503 and a
 * `Retry-After` rather than left to die on the gateway's idle timeout, which
 * would reach the caller as a dead socket instead of something it can act on.
 */

/** Narrowing filters that make a list request a point read rather than a sweep. */
const NARROWING_PARAMS = [
  'id',
  'ids',
  'slug',
  'personId',
  'positionId',
  'raceSlug',
  'geoId',
  'gpApiUserId',
] as const

/**
 * How many of these reads may run at once, per task.
 *
 * 8 against a pool of 25 leaves 17 for everything else, which is far more than
 * the rest of the traffic uses: the heat map is the heaviest of the point reads
 * at roughly 3 queries of ~30 ms each, so at its measured ~8 requests a second
 * it occupies well under one connection on average.
 *
 * It also happens to equal the sweeping caller's own concurrency, so a single
 * sweep runs exactly as fast as it does today and only a second concurrent
 * sweep queues. That is a coincidence worth keeping rather than a coupling —
 * if the caller raises its own limit this one should not follow it upward.
 */
const DEFAULT_BULK_CONCURRENCY = 8

/**
 * How long a read may wait for a permit.
 *
 * Under the ~120 s gateway idle timeout on purpose, so the failure is a status
 * code rather than a killed connection, and above the time a realistic burst
 * takes to drain (44 reads at 8 at a time and ~10 s each is roughly 55 s) so
 * that it is a backstop and not part of normal operation.
 */
const DEFAULT_BULK_WAIT_MS = 90_000

const positiveIntFromEnv = (name: string, fallback: number): number => {
  const parsed = Number.parseInt(process.env[name] ?? '', 10)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback
}

@Injectable()
export class BulkListConcurrencyInterceptor implements NestInterceptor {
  private readonly waitMs = positiveIntFromEnv(
    'ELECTION_API_BULK_LIST_WAIT_MS',
    DEFAULT_BULK_WAIT_MS,
  )

  // One semaphore for all three routes, because they share the one pool they
  // are being kept out of. Per-route limits would each have to be sized against
  // the others to add up, which is a sum nobody would maintain.
  private readonly semaphore = new Semaphore(
    positiveIntFromEnv(
      'ELECTION_API_BULK_LIST_CONCURRENCY',
      DEFAULT_BULK_CONCURRENCY,
    ),
  )

  async intercept(
    context: ExecutionContext,
    next: CallHandler,
  ): Promise<Observable<unknown>> {
    if (!isBulkRead(context)) return next.handle()

    let release: () => void
    try {
      release = await this.semaphore.acquire(this.waitMs)
    } catch (error) {
      if (error instanceof SemaphoreTimeoutError) {
        throw new ServiceUnavailableException(
          'Too many whole-list reads in progress; retry shortly',
        )
      }
      throw error
    }

    try {
      return next.handle().pipe(finalize(release))
    } catch (error) {
      // `next.handle()` should not throw synchronously, but a permit leaked here
      // is permanent and silent, so it is not worth assuming.
      release()
      throw error
    }
  }
}

/**
 * Whether this request asks for a whole table slice rather than a named entity.
 *
 * Judged by the absence of any narrowing filter, not by the presence of `state`:
 * a request with no filters at all is the widest read available and must be
 * throttled, and it would pass a `state`-based test. Anything naming a single
 * entity — or a batch of ids, which is already bounded by the caller — goes
 * through untouched, because those are the reads this exists to protect.
 */
const isBulkRead = (context: ExecutionContext): boolean => {
  if (context.getType() !== 'http') return false

  const query = context.switchToHttp().getRequest<FastifyRequest>().query
  if (query === null || typeof query !== 'object') return true

  const params = query as Record<string, unknown>
  return !NARROWING_PARAMS.some((name) => {
    const value = params[name]
    if (value === undefined || value === null || value === '') return false
    return !Array.isArray(value) || value.length > 0
  })
}

export const __test__ = { isBulkRead, NARROWING_PARAMS }
