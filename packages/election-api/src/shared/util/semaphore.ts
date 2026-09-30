/**
 * A counting semaphore with a bounded wait.
 *
 * Exists so that one class of slow request cannot take every Prisma connection
 * a task owns. See `bulk-list-concurrency.interceptor.ts` for the incident that
 * motivated it; the short version is that the pool is 25 per task, the
 * unpaginated whole-state list reads take 8-13 seconds each, and enough of them
 * in flight at once leaves nothing for anybody else.
 *
 * THE WAIT IS BOUNDED, and that is not a detail. An unbounded queue in front of
 * a pool is the same failure one level up: requests pile in, every one of them
 * eventually exceeds the caller's patience or the gateway's idle timeout, and
 * the caller sees a dead socket rather than an answer. A bounded wait turns that
 * into a status code somebody can read and retry.
 *
 * FIFO, so a queued caller cannot be starved by a steady stream of new arrivals.
 */
export class Semaphore {
  private available: number
  private readonly waiters: {
    resolve: () => void
    reject: (reason: Error) => void
    timer: ReturnType<typeof setTimeout>
  }[] = []

  constructor(permits: number) {
    if (!Number.isInteger(permits) || permits < 1) {
      throw new Error(`Semaphore needs at least 1 permit, got ${permits}`)
    }
    this.available = permits
  }

  /**
   * Takes a permit, waiting at most `timeoutMs`, and returns the function that
   * gives it back.
   *
   * The release function is idempotent: calling it twice must not hand out a
   * permit that was never taken, because the caller releases from a `finalize`
   * and an observable that both errors and completes would otherwise inflate
   * the pool silently.
   */
  async acquire(timeoutMs: number): Promise<() => void> {
    if (this.available > 0) {
      this.available--
      return this.releaser()
    }

    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        const index = this.waiters.findIndex((w) => w.timer === timer)
        if (index !== -1) this.waiters.splice(index, 1)
        reject(new SemaphoreTimeoutError(timeoutMs))
      }, timeoutMs)

      // `unref` where the runtime has it, so a pending wait cannot hold the
      // process open during a shutdown.
      timer.unref?.()

      this.waiters.push({ resolve, reject, timer })
    })

    return this.releaser()
  }

  private releaser(): () => void {
    let released = false
    return () => {
      if (released) return
      released = true

      const next = this.waiters.shift()
      if (next) {
        clearTimeout(next.timer)
        // Hand the permit straight to the waiter rather than incrementing and
        // letting it re-check: incrementing first opens a window for a brand
        // new arrival to take it, which is how a FIFO queue starves.
        next.resolve()
        return
      }
      this.available++
    }
  }

  /** Permits not currently held. Exposed for tests and for a health read. */
  get free(): number {
    return this.available
  }

  /** Callers currently queued. Exposed for tests and for a health read. */
  get queued(): number {
    return this.waiters.length
  }
}

export class SemaphoreTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`Timed out after ${timeoutMs}ms waiting for a permit`)
    this.name = 'SemaphoreTimeoutError'
  }
}
