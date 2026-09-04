import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CLERK_API_TIMEOUT_MS } from '@/vendors/clerk/clerk.consts'
import { clerkCall, ClerkTimeoutError } from './clerkCall.util'

// Stands in for a Clerk call that never settles, so the only way the
// caller can proceed is the timeout.
const hangForever = <T>(): Promise<T> => new Promise(() => undefined)

describe('clerkCall', () => {
  it('resolves with the operation result when it completes', async () => {
    await expect(
      clerkCall('op', {}, () => Promise.resolve('ok')),
    ).resolves.toBe('ok')
  })

  describe('timeout', () => {
    beforeEach(() => {
      vi.useFakeTimers()
    })

    afterEach(() => {
      vi.useRealTimers()
    })

    it('times out at CLERK_API_TIMEOUT_MS when no override is given', async () => {
      const pending = clerkCall('op', {}, hangForever)
      const assertion =
        expect(pending).rejects.toBeInstanceOf(ClerkTimeoutError)
      await vi.advanceTimersByTimeAsync(CLERK_API_TIMEOUT_MS)

      await assertion
    })

    it('honors a per-call timeout override shorter than the default', async () => {
      // If the override were ignored in favor of CLERK_API_TIMEOUT_MS, this
      // promise would still be pending at overrideMs and the assertion below
      // would never settle.
      const overrideMs = 500
      const pending = clerkCall('op', {}, hangForever, overrideMs)
      const assertion =
        expect(pending).rejects.toBeInstanceOf(ClerkTimeoutError)
      await vi.advanceTimersByTimeAsync(overrideMs)

      await assertion
    })

    it('honors a per-call timeout override longer than the default', async () => {
      const overrideMs = CLERK_API_TIMEOUT_MS + 5_000
      const pending = clerkCall('op', {}, hangForever, overrideMs)
      const assertion =
        expect(pending).rejects.toBeInstanceOf(ClerkTimeoutError)
      await vi.advanceTimersByTimeAsync(overrideMs)

      await assertion
    })
  })
})
