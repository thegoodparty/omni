import { describe, expect, it, vi } from 'vitest'
import { coalesceKey, InFlightCoalescer } from './coalesce.util'

/** A promise plus the handles to settle it from the test body. */
const deferred = <T>() => {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

describe('InFlightCoalescer', () => {
  it('runs the work once for concurrent callers on the same key', async () => {
    const coalescer = new InFlightCoalescer()
    const gate = deferred<string[]>()
    const work = vi.fn(() => gate.promise)

    // Fourteen concurrent identical reads is what prod measured per
    // (endpoint, state) in the ten minutes to 2026-09-29T15:00Z.
    const callers = Array.from({ length: 14 }, () =>
      coalescer.run('persons:CA', work),
    )
    expect(work).toHaveBeenCalledTimes(1)
    expect(coalescer.size).toBe(1)

    gate.resolve(['a', 'b'])
    const results = await Promise.all(callers)

    expect(work).toHaveBeenCalledTimes(1)
    expect(results.every((r) => r === results[0])).toBe(true)
    expect(results[0]).toEqual(['a', 'b'])
  })

  it('keeps different keys independent', async () => {
    const coalescer = new InFlightCoalescer()
    const work = vi.fn(async (state: string) => state)

    const [ca, il] = await Promise.all([
      coalescer.run('persons:CA', () => work('CA')),
      coalescer.run('persons:IL', () => work('IL')),
    ])

    expect(work).toHaveBeenCalledTimes(2)
    expect([ca, il]).toEqual(['CA', 'IL'])
  })

  it('is not a cache: a caller arriving after the work settles re-runs it', async () => {
    const coalescer = new InFlightCoalescer()
    const work = vi.fn(async () => 'rows')

    await coalescer.run('persons:CA', work)
    expect(coalescer.size).toBe(0)
    await coalescer.run('persons:CA', work)

    expect(work).toHaveBeenCalledTimes(2)
  })

  it('shares a rejection with the waiters and does not cache the failure', async () => {
    const coalescer = new InFlightCoalescer()
    const gate = deferred<never>()
    const failing = vi.fn(() => gate.promise)

    const first = coalescer.run('persons:CA', failing)
    const second = coalescer.run('persons:CA', failing)
    gate.reject(new Error('P2024'))

    await expect(first).rejects.toThrow('P2024')
    await expect(second).rejects.toThrow('P2024')
    expect(failing).toHaveBeenCalledTimes(1)
    expect(coalescer.size).toBe(0)

    // The next caller gets a fresh attempt rather than the stored failure.
    await expect(coalescer.run('persons:CA', async () => 'rows')).resolves.toBe(
      'rows',
    )
  })

  it('turns a synchronous throw into a rejection and still cleans up', async () => {
    const coalescer = new InFlightCoalescer()

    await expect(
      coalescer.run('persons:CA', () => {
        throw new Error('bad filter')
      }),
    ).rejects.toThrow('bad filter')
    expect(coalescer.size).toBe(0)
  })
})

describe('coalesceKey', () => {
  it('is insensitive to the order object keys were built in', () => {
    expect(coalesceKey({ state: 'CA', columns: 'id,slug' })).toBe(
      coalesceKey({ columns: 'id,slug', state: 'CA' }),
    )
  })

  it('sorts keys at every depth', () => {
    expect(coalesceKey({ a: { y: 1, x: 2 } })).toBe(
      coalesceKey({ a: { x: 2, y: 1 } }),
    )
  })

  it('treats an absent key and an undefined one as the same query', () => {
    expect(coalesceKey({ state: 'CA', slug: undefined })).toBe(
      coalesceKey({ state: 'CA' }),
    )
  })

  it('separates different filters, including by the leading namespace', () => {
    expect(coalesceKey('persons', { state: 'CA' })).not.toBe(
      coalesceKey('persons', { state: 'IL' }),
    )
    expect(coalesceKey('persons', { state: 'CA' })).not.toBe(
      coalesceKey('officeholders', { state: 'CA' }),
    )
  })

  it('does not collapse arrays that differ only in order', () => {
    // Sorting `ids` would be safe for `id: { in: [...] }` and unsafe for
    // anything order-bearing, so order is always significant here.
    expect(coalesceKey({ ids: ['a', 'b'] })).not.toBe(
      coalesceKey({ ids: ['b', 'a'] }),
    )
  })

  it('leaves non-plain objects to their own serialisation', () => {
    const at = new Date('2026-09-29T14:58:39.000Z')
    expect(coalesceKey({ at })).toContain('2026-09-29T14:58:39.000Z')
  })
})
