import { ExecutionContext, ServiceUnavailableException } from '@nestjs/common'
import { Observable, of, Subject } from 'rxjs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const settle = () => new Promise((resolve) => setImmediate(resolve))

const contextFor = (query: unknown): ExecutionContext =>
  ({
    getType: () => 'http',
    switchToHttp: () => ({ getRequest: () => ({ query }) }),
  }) as unknown as ExecutionContext

/**
 * Re-imports the interceptor so the env-derived limits are read fresh. They are
 * read at construction, which is what a deploy does, so a test that wants a
 * different limit has to re-enter the module.
 */
const loadInterceptor = async (env: Record<string, string> = {}) => {
  vi.resetModules()
  for (const [key, value] of Object.entries(env)) vi.stubEnv(key, value)
  return import('./bulk-list-concurrency.interceptor')
}

describe('isBulkRead', () => {
  let isBulkRead: (context: ExecutionContext) => boolean

  beforeEach(async () => {
    const mod = await loadInterceptor()
    isBulkRead = mod.__test__.isBulkRead
  })

  it('treats a whole-state sweep as bulk', () => {
    expect(isBulkRead(contextFor({ state: 'CA', columns: 'id,slug' }))).toBe(
      true,
    )
  })

  it('treats a request with no filters at all as bulk', () => {
    // The widest read available, and it carries no `state` — so the test cannot
    // be "does it name a state".
    expect(isBulkRead(contextFor({}))).toBe(true)
    expect(isBulkRead(contextFor(undefined))).toBe(true)
  })

  it('lets a request that names one entity through', () => {
    expect(isBulkRead(contextFor({ slug: 'jane-doe-abc12345' }))).toBe(false)
    expect(isBulkRead(contextFor({ personId: 'a-uuid' }))).toBe(false)
    expect(isBulkRead(contextFor({ raceSlug: 'ga/worth-county/chair' }))).toBe(
      false,
    )
    expect(isBulkRead(contextFor({ geoId: '12057' }))).toBe(false)
  })

  it('lets a bounded batch of ids through but not an empty one', () => {
    expect(isBulkRead(contextFor({ ids: ['a', 'b'] }))).toBe(false)
    expect(isBulkRead(contextFor({ ids: [] }))).toBe(true)
    expect(isBulkRead(contextFor({ slug: '' }))).toBe(true)
  })
})

describe('BulkListConcurrencyInterceptor', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.useRealTimers()
  })

  it('does not throttle a point read', async () => {
    const { BulkListConcurrencyInterceptor } = await loadInterceptor({
      ELECTION_API_BULK_LIST_CONCURRENCY: '1',
    })
    const interceptor = new BulkListConcurrencyInterceptor()
    const handler = { handle: () => of('rows') }

    const held = await interceptor.intercept(contextFor({ state: 'CA' }), {
      handle: () => new Subject(),
    } as never)
    expect(held).toBeInstanceOf(Observable)

    // The only permit is now held by the bulk read above, and a point read must
    // still be served rather than queued behind it.
    const result = await interceptor.intercept(
      contextFor({ slug: 'jane' }),
      handler as never,
    )
    expect(result).toBeInstanceOf(Observable)
  })

  it('queues a bulk read past the limit and releases on completion', async () => {
    const { BulkListConcurrencyInterceptor } = await loadInterceptor({
      ELECTION_API_BULK_LIST_CONCURRENCY: '1',
    })
    const interceptor = new BulkListConcurrencyInterceptor()

    const inFlight = new Subject<string>()
    const first = await interceptor.intercept(contextFor({ state: 'CA' }), {
      handle: () => inFlight,
    } as never)
    const firstSub = first.subscribe()

    let secondAdmitted = false
    const second = interceptor
      .intercept(contextFor({ state: 'IL' }), {
        handle: () => of('rows'),
      } as never)
      .then((obs) => {
        secondAdmitted = true
        return obs
      })

    await settle()
    expect(secondAdmitted).toBe(false)

    inFlight.complete()
    firstSub.unsubscribe()
    await settle()

    await second
    expect(secondAdmitted).toBe(true)
  })

  it('releases the permit when the handler errors', async () => {
    const { BulkListConcurrencyInterceptor } = await loadInterceptor({
      ELECTION_API_BULK_LIST_CONCURRENCY: '1',
    })
    const interceptor = new BulkListConcurrencyInterceptor()

    const failing = new Subject<string>()
    const first = await interceptor.intercept(contextFor({ state: 'CA' }), {
      handle: () => failing,
    } as never)
    first.subscribe({ error: () => undefined })
    failing.error(new Error('P2024'))
    await settle()

    // If the failed read had leaked its permit this would never resolve.
    const second = await interceptor.intercept(contextFor({ state: 'IL' }), {
      handle: () => of('rows'),
    } as never)
    expect(second).toBeInstanceOf(Observable)
  })

  it('refuses with 503 rather than waiting past the gateway timeout', async () => {
    const { BulkListConcurrencyInterceptor } = await loadInterceptor({
      ELECTION_API_BULK_LIST_CONCURRENCY: '1',
      ELECTION_API_BULK_LIST_WAIT_MS: '10',
    })
    const interceptor = new BulkListConcurrencyInterceptor()

    const held = await interceptor.intercept(contextFor({ state: 'CA' }), {
      handle: () => new Subject(),
    } as never)
    held.subscribe()

    await expect(
      interceptor.intercept(contextFor({ state: 'IL' }), {
        handle: () => of('rows'),
      } as never),
    ).rejects.toBeInstanceOf(ServiceUnavailableException)
  })

  it('falls back to the default when the env var is not a positive integer', async () => {
    const { BulkListConcurrencyInterceptor } = await loadInterceptor({
      ELECTION_API_BULK_LIST_CONCURRENCY: 'nonsense',
    })
    const interceptor = new BulkListConcurrencyInterceptor()

    // The default is 8, so nine concurrent bulk reads must admit eight.
    const subjects = Array.from({ length: 8 }, () => new Subject<string>())
    for (const subject of subjects) {
      const obs = await interceptor.intercept(contextFor({ state: 'CA' }), {
        handle: () => subject,
      } as never)
      obs.subscribe()
    }

    let ninthAdmitted = false
    void interceptor
      .intercept(contextFor({ state: 'IL' }), {
        handle: () => of('x'),
      } as never)
      .then(() => {
        ninthAdmitted = true
      })
      .catch(() => undefined)

    await settle()
    expect(ninthAdmitted).toBe(false)
    subjects.forEach((subject) => subject.complete())
  })
})
