import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common'
import type { FastifyReply, FastifyRequest } from 'fastify'
import { Observable, from, lastValueFrom, of } from 'rxjs'
import { IncomingRequest } from '@/authentication/authentication.types'

export const ELECTION_READ_CACHE_TTL_MS = 30_000
export const ELECTION_READ_CACHE_MAX_ENTRIES = 2_000

type CacheEntry =
  | { pending: Promise<object> }
  | { value: object; expiresAt: number }

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

  /** Test seam: a cached 200 must never answer a later test's same URL. */
  static clear(): void {
    ElectionReadCacheInterceptor.entries.clear()
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
        if (cached.expiresAt > Date.now()) return of(cached.value)
        entries.delete(key)
      } else {
        return from(cached.pending)
      }
    }

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
          )
          return value
        },
        (error) => {
          // A failed read is not an answer; the next request must retry.
          if (entries.get(key) === entry) entries.delete(key)
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
  ): void {
    const entries = ElectionReadCacheInterceptor.entries
    // Evicted while the read was in flight: writing it back would throw away
    // whatever took its place.
    if (entries.get(key) !== entry) return
    entries.delete(key)
    if (statusCode !== 200) return

    // Re-inserted so the map stays in least-recently-answered order, which is
    // the eviction order below.
    entries.set(key, {
      value,
      expiresAt: Date.now() + ELECTION_READ_CACHE_TTL_MS,
    })
    for (const oldest of entries.keys()) {
      if (entries.size <= ELECTION_READ_CACHE_MAX_ENTRIES) break
      entries.delete(oldest)
    }
  }
}

// The query string is the caller's filter, so two requests differing only in
// the order they wrote it answer the same document and must share an entry.
const cacheKey = (req: FastifyRequest): string => {
  const [path, query = ''] = (req.url ?? '').split('?')
  const params = [...new URLSearchParams(query).entries()].sort(
    ([leftKey, leftValue], [rightKey, rightValue]) =>
      leftKey === rightKey
        ? leftValue.localeCompare(rightValue)
        : leftKey.localeCompare(rightKey),
  )
  return `${req.method} ${path}?${new URLSearchParams(params).toString()}`
}
