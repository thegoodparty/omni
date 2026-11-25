import { CallHandler, ExecutionContext } from '@nestjs/common'
import { Observable, lastValueFrom } from 'rxjs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  ELECTION_READ_CACHE_MAX_ENTRIES,
  ELECTION_READ_CACHE_TTL_MS,
  ElectionReadCacheInterceptor,
} from './electionReadCache.interceptor'

const machine = { serviceReader: {}, method: 'GET' }

const contextFor = (req: object, statusCode = 200) =>
  ({
    switchToHttp: () => ({
      getRequest: () => req,
      getResponse: () => ({ statusCode }),
    }),
  }) as unknown as ExecutionContext

const url = (path: string) => ({ ...machine, url: path })

const handlerOf = (resolve: () => object) => {
  const handle = vi.fn(
    () =>
      new Observable<object>((sub) => {
        void Promise.resolve()
          .then(resolve)
          .then(
            (value) => {
              sub.next(value)
              sub.complete()
            },
            (error) => sub.error(error),
          )
      }),
  )
  return { handler: { handle } as CallHandler<object>, handle }
}

describe('ElectionReadCacheInterceptor', () => {
  beforeEach(() => ElectionReadCacheInterceptor.clear())

  afterEach(() => {
    vi.useRealTimers()
  })

  it('collapses ten identical concurrent reads into one downstream call', async () => {
    const interceptor = new ElectionReadCacheInterceptor()
    const { handler, handle } = handlerOf(() => ({ id: 'race-1' }))

    const reads = Array.from({ length: 10 }, () =>
      lastValueFrom(
        interceptor.intercept(
          contextFor(url('/v1/elections/races?state=WY')),
          handler,
        ),
      ),
    )

    await expect(Promise.all(reads)).resolves.toEqual(
      Array.from({ length: 10 }, () => ({ id: 'race-1' })),
    )
    expect(handle).toHaveBeenCalledOnce()
  })

  it('answers a repeat read inside the ttl without going downstream', async () => {
    const interceptor = new ElectionReadCacheInterceptor()
    const { handler, handle } = handlerOf(() => ({ id: 'race-1' }))
    const context = contextFor(url('/v1/elections/races?state=WY'))

    const first = await lastValueFrom(interceptor.intercept(context, handler))
    const second = await lastValueFrom(interceptor.intercept(context, handler))

    expect(second).toEqual(first)
    expect(handle).toHaveBeenCalledOnce()
  })

  it('does not merge two different query values', async () => {
    const interceptor = new ElectionReadCacheInterceptor()
    const { handler, handle } = handlerOf(() => ({ races: [] }))

    await lastValueFrom(
      interceptor.intercept(
        contextFor(url('/v1/elections/races?state=WY')),
        handler,
      ),
    )
    await lastValueFrom(
      interceptor.intercept(
        contextFor(url('/v1/elections/races?state=MI')),
        handler,
      ),
    )

    expect(handle).toHaveBeenCalledTimes(2)
  })

  it('shares an entry between requests that only reorder the query string', async () => {
    const interceptor = new ElectionReadCacheInterceptor()
    const { handler, handle } = handlerOf(() => ({ races: [] }))

    await lastValueFrom(
      interceptor.intercept(
        contextFor(url('/v1/elections/races?state=WY&includeChildren=true')),
        handler,
      ),
    )
    await lastValueFrom(
      interceptor.intercept(
        contextFor(url('/v1/elections/races?includeChildren=true&state=WY')),
        handler,
      ),
    )

    expect(handle).toHaveBeenCalledOnce()
  })

  it('asks again once the ttl has passed', async () => {
    vi.useFakeTimers()
    const interceptor = new ElectionReadCacheInterceptor()
    const { handler, handle } = handlerOf(() => ({ races: [] }))
    const context = contextFor(url('/v1/elections/races?state=WY'))

    await lastValueFrom(interceptor.intercept(context, handler))
    vi.advanceTimersByTime(ELECTION_READ_CACHE_TTL_MS + 1)
    await lastValueFrom(interceptor.intercept(context, handler))

    expect(handle).toHaveBeenCalledTimes(2)
  })

  it('never caches a failed read', async () => {
    const interceptor = new ElectionReadCacheInterceptor()
    const context = contextFor(url('/v1/elections/races?state=WY'))
    const failing = handlerOf(() => {
      throw new Error('pool timed out')
    })

    await expect(
      lastValueFrom(interceptor.intercept(context, failing.handler)),
    ).rejects.toThrow('pool timed out')

    const recovered = handlerOf(() => ({ races: [] }))
    const read = await lastValueFrom(
      interceptor.intercept(context, recovered.handler),
    )

    expect(read).toEqual({ races: [] })
    expect(failing.handle).toHaveBeenCalledOnce()
    expect(recovered.handle).toHaveBeenCalledOnce()
  })

  it('never caches a response that is not a 200', async () => {
    const interceptor = new ElectionReadCacheInterceptor()
    const { handler, handle } = handlerOf(() => ({ races: [] }))
    const context = contextFor(url('/v1/elections/races?state=WY'), 502)

    await lastValueFrom(interceptor.intercept(context, handler))
    await lastValueFrom(interceptor.intercept(context, handler))

    expect(handle).toHaveBeenCalledTimes(2)
  })

  it('leaves human callers uncached', async () => {
    const interceptor = new ElectionReadCacheInterceptor()
    const { handler, handle } = handlerOf(() => ({ races: [] }))
    const context = contextFor({ method: 'GET', url: '/v1/elections/races' })

    await lastValueFrom(interceptor.intercept(context, handler))
    await lastValueFrom(interceptor.intercept(context, handler))

    expect(handle).toHaveBeenCalledTimes(2)
  })

  it('leaves anything but a GET uncached', async () => {
    const interceptor = new ElectionReadCacheInterceptor()
    const { handler, handle } = handlerOf(() => ({ races: [] }))
    const context = contextFor({
      serviceReader: {},
      method: 'POST',
      url: '/v1/elections/races',
    })

    await lastValueFrom(interceptor.intercept(context, handler))
    await lastValueFrom(interceptor.intercept(context, handler))

    expect(handle).toHaveBeenCalledTimes(2)
  })

  it('stays bounded when callers rotate the query string', async () => {
    const interceptor = new ElectionReadCacheInterceptor()
    const { handler } = handlerOf(() => ({ races: [] }))
    const reads = Array.from(
      { length: ELECTION_READ_CACHE_MAX_ENTRIES + 10 },
      (_, index) =>
        lastValueFrom(
          interceptor.intercept(
            contextFor(url(`/v1/elections/races?offset=${index}`)),
            handler,
          ),
        ),
    )
    await Promise.all(reads)

    const entries: Map<string, object> = (
      ElectionReadCacheInterceptor as unknown as {
        entries: Map<string, object>
      }
    ).entries
    expect(entries.size).toBeLessThanOrEqual(ELECTION_READ_CACHE_MAX_ENTRIES)
  })
})
