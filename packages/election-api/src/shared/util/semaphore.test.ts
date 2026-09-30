import { describe, expect, it, vi } from 'vitest'
import { Semaphore, SemaphoreTimeoutError } from './semaphore'

const settle = () => new Promise((resolve) => setImmediate(resolve))

describe('Semaphore', () => {
  it('rejects a permit count below one', () => {
    expect(() => new Semaphore(0)).toThrow(/at least 1 permit/)
    expect(() => new Semaphore(1.5)).toThrow(/at least 1 permit/)
  })

  it('lets its permit count through and queues the rest', async () => {
    const semaphore = new Semaphore(8)
    const releases = await Promise.all(
      Array.from({ length: 8 }, () => semaphore.acquire(1_000)),
    )

    expect(semaphore.free).toBe(0)
    expect(semaphore.queued).toBe(0)

    // The 44 concurrent whole-state reads prod measured, against 8 permits.
    const queued = Array.from({ length: 36 }, () => semaphore.acquire(5_000))
    await settle()
    expect(semaphore.queued).toBe(36)

    releases.forEach((release) => release())
    await settle()
    expect(semaphore.queued).toBe(28)

    // Drain the rest so the test leaves no pending timers.
    const drain = async () => {
      let remaining = 36
      while (remaining > 0) {
        const release = await queued[36 - remaining]!
        release()
        remaining--
      }
    }
    await drain()
  })

  it('hands a freed permit to the longest-waiting caller', async () => {
    const semaphore = new Semaphore(1)
    const order: number[] = []
    const first = await semaphore.acquire(1_000)

    const second = semaphore.acquire(1_000).then((release) => {
      order.push(2)
      return release
    })
    await settle()
    const third = semaphore.acquire(1_000).then((release) => {
      order.push(3)
      return release
    })
    await settle()

    first()
    ;(await second)()
    ;(await third)()

    expect(order).toEqual([2, 3])
  })

  it('times out a caller that waits too long, and frees the queue slot', async () => {
    vi.useFakeTimers()
    try {
      const semaphore = new Semaphore(1)
      const held = await semaphore.acquire(1_000)

      const waiting = semaphore.acquire(50)
      await Promise.resolve()
      expect(semaphore.queued).toBe(1)

      vi.advanceTimersByTime(60)
      await expect(waiting).rejects.toBeInstanceOf(SemaphoreTimeoutError)
      expect(semaphore.queued).toBe(0)

      // The permit was never taken by the timed-out caller, so releasing the
      // holder must return it rather than hand it to a ghost.
      held()
      expect(semaphore.free).toBe(1)
    } finally {
      vi.useRealTimers()
    }
  })

  it('does not inflate the permit count when release is called twice', async () => {
    const semaphore = new Semaphore(2)
    const release = await semaphore.acquire(1_000)

    expect(semaphore.free).toBe(1)
    release()
    release()
    release()
    expect(semaphore.free).toBe(2)
  })

  it('a double release cannot wake the same waiter twice', async () => {
    const semaphore = new Semaphore(1)
    const release = await semaphore.acquire(1_000)
    const queued = semaphore.acquire(1_000)
    await settle()

    release()
    release()
    const queuedRelease = await queued

    expect(semaphore.queued).toBe(0)
    expect(semaphore.free).toBe(0)
    queuedRelease()
    expect(semaphore.free).toBe(1)
  })
})
