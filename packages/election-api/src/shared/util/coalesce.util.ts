/**
 * In-flight coalescing ("single flight") for read-only queries.
 *
 * WHY THIS EXISTS. election-api's list endpoints are unpaginated by contract:
 * `GET /v1/persons?state=CA&columns=id,slug` returns every person in the state
 * in one array, and the callers that build the public /people sitemaps depend
 * on getting the whole set. A single one of those reads is 0.6-6.9 MB and takes
 * 8-13 seconds, and for those seconds it holds one of the task's Prisma
 * connections.
 *
 * On 2026-09-25 and again on 2026-09-29 that collided with the fact that
 * callers ask the same question many times over. Measured in prod over the ten
 * minutes to 2026-09-29T15:00Z: exactly 14 identical requests per
 * (endpoint, state) across `/v1/persons`, `/v1/officeholders` and
 * `/v1/candidacies` — five identical `state=KS` reads inside 600 ms. Fourteen
 * copies of an eight-second query are fourteen connections held for eight
 * seconds, and the pool is 25 per task (`prisma.service.ts`). Once it is empty
 * every other read queues, waits out the 20-second acquire timeout and fails
 * with Prisma P2024. The voter-density heat map on public profile pages was the
 * visible casualty: 825 visitors got a 502 instead of a map in a single
 * 15-minute window, with the database itself idle throughout (CPU under 20%,
 * ReadLatency ~1 ms, connections pinned at exactly 2 tasks x 25).
 *
 * So the constraint was never Postgres and it was never the size of the pool.
 * It was that we answered the same question fourteen times concurrently. This
 * makes the second through fourteenth callers await the first caller's query
 * instead of opening their own.
 *
 * WHAT IT IS NOT: a cache. An entry lives only while its promise is pending and
 * is removed the moment it settles, so a request that arrives after the query
 * finishes always starts a fresh one. There is no TTL to tune, no invalidation
 * to get wrong, and no window in which a caller can be handed data older than
 * the request it made. The only behaviour that changes is how many database
 * round-trips a burst of identical concurrent reads costs.
 *
 * CALLERS MUST TREAT THE RESULT AS READ-ONLY. Coalesced callers share one
 * object graph rather than each getting their own, so mutating it would be
 * visible to the others. Every call site is a handler that returns the value
 * straight to the response serialiser, which is why this is a documented
 * contract rather than a deep freeze — freezing a hundred thousand rows would
 * cost more than the duplication it protects against.
 *
 * ONLY SAFE FOR READS WHOSE RESULT DEPENDS ENTIRELY ON THE KEY. Do not wrap
 * work that varies with the caller's identity or authorisation unless that is
 * part of the key. The three list handlers qualify: their result is a pure
 * function of the validated filter DTO, and the one authorisation check that
 * exists (`gpApiUserId` requires an M2M token) runs in the controller before
 * the service is reached.
 */
export class InFlightCoalescer {
  private readonly pending = new Map<string, Promise<unknown>>()

  /**
   * Runs `work`, or joins the identical run already in progress.
   *
   * The entry is registered before `work`'s promise is returned to anyone, so
   * two callers arriving in the same tick cannot both miss. It is removed in a
   * `finally`, so a rejection is shared by exactly the callers that were
   * already waiting and never by a later one — a failed read is not cached as a
   * failure.
   */
  run<T>(key: string, work: () => Promise<T>): Promise<T> {
    const existing = this.pending.get(key)
    if (existing) return existing as Promise<T>

    // `work()` is invoked inside the promise chain rather than before it so a
    // synchronous throw becomes a rejection of the shared promise, which keeps
    // the cleanup below on one path instead of two.
    const shared = (async () => work())().finally(() => {
      this.pending.delete(key)
    })

    this.pending.set(key, shared)
    return shared
  }

  /** How many distinct reads are in flight. Exposed for tests. */
  get size(): number {
    return this.pending.size
  }
}

/**
 * A stable string for a set of query inputs.
 *
 * `JSON.stringify` is not enough on its own: it preserves insertion order, and
 * two validated DTOs describing the same query can carry their keys in
 * different orders, which would make identical reads look distinct and quietly
 * turn coalescing off. Object keys are therefore sorted at every depth.
 *
 * ARRAY ORDER IS PRESERVED. It is tempting to sort `ids` too, since `id: { in:
 * [...] }` does not care about order — but the key has to distinguish anything
 * that could change the result, and an array whose order does matter (an
 * `orderBy` list, say) would be flattened into a false match. Two callers who
 * send the same ids in a different order simply do not coalesce, which costs a
 * query and cannot return the wrong answer.
 *
 * `undefined` is dropped by `JSON.stringify` inside objects, so an absent key
 * and an explicitly-undefined one produce the same string. That is what we
 * want: they produce the same query.
 */
export const coalesceKey = (...parts: unknown[]): string =>
  JSON.stringify(parts, (_key, value) => {
    if (
      value === null ||
      typeof value !== 'object' ||
      Array.isArray(value) ||
      !isPlainObject(value)
    ) {
      return value
    }

    return Object.fromEntries(
      Object.keys(value as Record<string, unknown>)
        .sort()
        .map((key) => [key, (value as Record<string, unknown>)[key]]),
    )
  })

/**
 * Whether a value is a plain object whose keys are safe to reorder.
 *
 * A `Date` or a Prisma `Decimal` is an object with no own enumerable keys, and
 * rebuilding it as `{}` would erase it from the key — so anything that is not a
 * plain object is passed through untouched and left to its own
 * `toJSON`/serialisation.
 */
const isPlainObject = (value: object): boolean => {
  const proto = Object.getPrototypeOf(value)
  return proto === Object.prototype || proto === null
}
