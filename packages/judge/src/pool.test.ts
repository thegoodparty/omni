import { describe, expect, it } from 'vitest'
import { runPool } from './pool'

const deferred = () => {
  let release = () => {}
  const promise = new Promise<void>((resolve) => {
    release = resolve
  })
  return { promise, release: () => release() }
}

describe('runPool', () => {
  it('returns results in the order they were handed in', async () => {
    const results = await runPool([3, 1, 2], 2, async (value) => {
      await new Promise((resolve) => setTimeout(resolve, value))
      return value * 10
    })
    expect(results).toEqual([30, 10, 20])
  })

  it('never has more than the concurrency in flight', async () => {
    let inFlight = 0
    let peak = 0
    await runPool([1, 2, 3, 4, 5, 6, 7, 8], 3, async (value) => {
      inFlight += 1
      peak = Math.max(peak, inFlight)
      await new Promise((resolve) => setTimeout(resolve, 1))
      inFlight -= 1
      return value
    })
    expect(peak).toBe(3)
  })

  it('runs every item even when the pool is larger than the work', async () => {
    const seen: number[] = []
    await runPool([1, 2], 16, async (value) => {
      seen.push(value)
    })
    expect(seen.sort()).toEqual([1, 2])
  })

  it('starts every item at once when the concurrency covers them', async () => {
    const gates = [deferred(), deferred()]
    let started = 0
    const running = runPool([0, 1], 2, async (index) => {
      started += 1
      await gates[index]!.promise
    })
    // Both lanes reach their first item before either gate opens.
    await new Promise((resolve) => setTimeout(resolve, 1))
    expect(started).toBe(2)
    gates[0]!.release()
    gates[1]!.release()
    await running
  })

  it('returns an empty array for no items', async () => {
    expect(await runPool([], 4, async () => 1)).toEqual([])
  })

  it('rejects a concurrency below one', async () => {
    await expect(runPool([1], 0, async () => 1)).rejects.toThrow(/at least 1/)
  })
})
