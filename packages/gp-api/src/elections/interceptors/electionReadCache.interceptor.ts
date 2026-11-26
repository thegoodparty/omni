import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common'
import type { FastifyReply, FastifyRequest } from 'fastify'
import { PinoLogger } from 'nestjs-pino'
import { Observable, from, lastValueFrom, of } from 'rxjs'
import { IncomingRequest } from '@/authentication/authentication.types'

export const ELECTION_READ_CACHE_TTL_MS = 30_000
export const ELECTION_READ_CACHE_MAX_ENTRIES = 2_000
// A 5,000-row page of races with its candidacies is tens of megabytes, so the
// page-size ceiling is not a memory bound. These are: one entry the size of a
// briefing artifact, and a total under 1% of the task's 4096 MB, which the pgboss
// workers share.
export const ELECTION_READ_CACHE_MAX_ENTRY_BYTES = 1_048_576
export const ELECTION_READ_CACHE_MAX_BYTES = 33_554_432

// Per task, so a rate, not a count: the crawl spreads identical reads across
// the fleet, and a human needs to see whether this is doing anything at all
// after a deploy (ENG-11791).
const SUMMARY_EVERY_DECISIONS = 1_000

type CacheEntry =
  | { pending: Promise<object> }
  | { value: object; bytes: number; expiresAt: number }

interface Counters {
  hits: number
  joins: number
  misses: number
  oversized: number
}

/**
 * Answers an identical machine-caller election read from memory for
 * `ELECTION_READ_CACHE_TTL_MS`, and collapses the reads that are already in
 * flight onto one downstream call.
 *
 * The gp-marketing crawl asks for the same few hundred documents over and
 * over: one URL was fetched ten times in sixty seconds, and every ask was a
 * fresh set of two or three SQL statements against the 50-connection
 * election-db pool. That is what exhausted the pool on 2026-11-25 — the reads
 * were not slow, there were simply far more of them than there were
 * connections, and the ones that lost the race got a P2024 at the 5s acquire
 * timeout. Everything under `GET /v1/elections/*` is public reference data
 * that only the nightly swap writes, so an answer a few seconds old is not a
 * freshness a visitor can notice, and the requests that arrive while a read is
 * in flight can share its answer instead of opening a connection of their own.
 *
 * The cache is per task, and the fleet routes by least outstanding requests, so
 * an identical read lands on the task holding its entry only some of the time:
 * the more tasks the wave scales out, the lower the hit rate. The in-flight
 * join is exact regardless (it is decided inside one task, by whatever arrives
 * together), which is the part that keeps a burst of duplicates off the pool;
 * the TTL hits are the part that depends on the fleet size. The counters logged
 * every `SUMMARY_EVERY_DECISIONS` requests are what settle it in prod.
 *
 * This is not the read cap (`ServiceReadConcurrencyInterceptor`) and does not
 * replace it: that cap decides who gets refused when the pool is already
 * busy, this one stops the same work from being done twice. Human callers are
 * not cached — their reads are cheap, they are not what drained the pool, and
 * the map should not sit on every voter's district picker.
 *
 * Deliberately not applied to `public-person-profiles`, although it shares the
 * same pool and the same read cap: an owner publishing their profile must see
 * it live on the next render, and a 30s window of the previous "unpublished"
 * answer is a behaviour regression, not a fresh-enough read. That set is ~4% of
 * a crawl wave; this one is the rest.
 */
@Injectable()
export class ElectionReadCacheInterceptor implements NestInterceptor<
  object,
  object
> {
  // Static for the same reason the read cap's budget is: the reads this covers
  // share one pool, and a document is the same document whichever controller
  // instance serves it.
  private static readonly entries = new Map<string, CacheEntry>()
  private static bytes = 0
  private static decisions = 0
  private static readonly counters: Counters = {
    hits: 0,
    joins: 0,
    misses: 0,
    oversized: 0,
  }

  constructor(private readonly logger: PinoLogger) {
    this.logger.setContext(ElectionReadCacheInterceptor.name)
  }

  /** Test seam: a cached 200 must never answer a later test's same URL. */
  static clear(): void {
    ElectionReadCacheInterceptor.entries.clear()
    ElectionReadCacheInterceptor.bytes = 0
    ElectionReadCacheInterceptor.decisions = 0
    Object.assign(ElectionReadCacheInterceptor.counters, {
      hits: 0,
      joins: 0,
      misses: 0,
      oversized: 0,
    })
  }

  intercept(
    context: ExecutionContext,
    next: CallHandler<object>,
  ): Observable<object> {
    const req = context
      .switchToHttp()
      .getRequest<FastifyRequest & IncomingRequest>()
    if (!req.serviceReader && !req.m2mToken) return next.handle()
    if (req.method !== 'GET') return next.handle()

    const entries = ElectionReadCacheInterceptor.entries
    const key = cacheKey(req)
    const cached = entries.get(key)
    if (cached) {
      if ('value' in cached) {
        if (cached.expiresAt > Date.now()) {
          // Re-inserted so eviction below is least-recently-answered, not
          // oldest-inserted.
          entries.delete(key)
          entries.set(key, cached)
          ElectionReadCacheInterceptor.counters.hits++
          this.noteDecision()
          return of(cached.value)
        }
        ElectionReadCacheInterceptor.forget(key, cached)
      } else {
        ElectionReadCacheInterceptor.counters.joins++
        this.noteDecision()
        return from(cached.pending)
      }
    }

    ElectionReadCacheInterceptor.counters.misses++
    this.noteDecision()
    const reply = context.switchToHttp().getResponse<FastifyReply>()
    // Subscribed here rather than when the response is consumed, so the read
    // finishes even if the caller that started it disconnects, and so the
    // promise the next identical request joins is the same one this request
    // is waiting on.
    const read = lastValueFrom(next.handle())
    const entry: CacheEntry = { pending: read }
    entries.set(key, entry)
    return from(
      read.then(
        (value) => {
          ElectionReadCacheInterceptor.remember(
            key,
            entry,
            value,
            reply.statusCode,
            this.logger,
          )
          return value
        },
        (error) => {
          // A failed read is not an answer; the next request must retry.
          ElectionReadCacheInterceptor.forget(key, entry)
          throw error
        },
      ),
    )
  }

  private static remember(
    key: string,
    entry: CacheEntry,
    value: object,
    statusCode: number,
    logger: PinoLogger,
  ): void {
    const entries = ElectionReadCacheInterceptor.entries
    // Evicted while the read was in flight: writing it back would throw away
    // whatever took its place.
    if (entries.get(key) !== entry) return
    entries.delete(key)
    if (statusCode !== 200) return

    const bytes = serializedBytes(value)
    if (bytes > ELECTION_READ_CACHE_MAX_ENTRY_BYTES) {
      ElectionReadCacheInterceptor.counters.oversized++
      logger.debug(
        { key, bytes },
        'Election read too large to cache; serving it uncached.',
      )
      return
    }

    const now = Date.now()
    ElectionReadCacheInterceptor.sweepExpired(now)
    entries.set(key, {
      value,
      bytes,
      expiresAt: now + ELECTION_READ_CACHE_TTL_MS,
    })
    ElectionReadCacheInterceptor.bytes += bytes
    ElectionReadCacheInterceptor.evictToFit()
  }

  // Expiry is otherwise only noticed when the same key is read again, so a
  // crawl that walks a long query space would hold its documents for as long as
  // the map takes to fill.
  private static sweepExpired(now: number): void {
    for (const [key, entry] of ElectionReadCacheInterceptor.entries) {
      if ('value' in entry && entry.expiresAt <= now) {
        ElectionReadCacheInterceptor.forget(key, entry)
      }
    }
  }

  private static evictToFit(): void {
    const entries = ElectionReadCacheInterceptor.entries
    for (const [key, entry] of entries) {
      const overEntries = entries.size > ELECTION_READ_CACHE_MAX_ENTRIES
      const overBytes =
        ElectionReadCacheInterceptor.bytes > ELECTION_READ_CACHE_MAX_BYTES
      if (!overEntries && !overBytes) break
      ElectionReadCacheInterceptor.forget(key, entry)
    }
  }

  private static forget(key: string, entry: CacheEntry): void {
    if (ElectionReadCacheInterceptor.entries.get(key) !== entry) return
    ElectionReadCacheInterceptor.entries.delete(key)
    if ('value' in entry) ElectionReadCacheInterceptor.bytes -= entry.bytes
  }

  private noteDecision(): void {
    ElectionReadCacheInterceptor.decisions++
    if (ElectionReadCacheInterceptor.decisions % SUMMARY_EVERY_DECISIONS !== 0)
      return
    const { hits, joins, misses, oversized } =
      ElectionReadCacheInterceptor.counters
    this.logger.info(
      {
        hits,
        joins,
        misses,
        oversized,
        entries: ElectionReadCacheInterceptor.entries.size,
        bytes: ElectionReadCacheInterceptor.bytes,
      },
      'Election read cache totals',
    )
  }
}

const serializedBytes = (value: object): number => {
  try {
    return Buffer.byteLength(JSON.stringify(value), 'utf8')
  } catch {
    return Number.POSITIVE_INFINITY
  }
}

// The query string is the caller's filter, so two requests differing only in
// the order they wrote it answer the same document and must share an entry.
// `indexOf` rather than `split`, because a `?` is legal inside a filter value
// (`raceSlug=x?`) and everything after the first one is still the query.
const cacheKey = (req: FastifyRequest): string => {
  const raw = req.url ?? ''
  const queryStart = raw.indexOf('?')
  const path = queryStart === -1 ? raw : raw.slice(0, queryStart)
  const query = queryStart === -1 ? '' : raw.slice(queryStart + 1)
  const params = [...new URLSearchParams(query).entries()].sort(
    ([leftKey, leftValue], [rightKey, rightValue]) =>
      leftKey === rightKey
        ? leftValue.localeCompare(rightValue)
        : leftKey.localeCompare(rightKey),
  )
  return `${req.method} ${path}?${new URLSearchParams(params).toString()}`
}
