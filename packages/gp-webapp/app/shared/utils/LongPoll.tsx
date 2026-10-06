import { noop, noopAsync } from './noop'
import { useEffect, useRef } from 'react'
import { useSingleEffect } from '@shared/hooks/useSingleEffect'

interface LongPollProps<T = void> {
  pollingMethod?: () => Promise<T | void>
  pollingDelay?: number
  // Returning `true` marks this tick's result terminal. That's the only
  // same-tick signal LongPoll has for it: a caller that's about to flip
  // `stopPolling` does so via React state, which won't reach this
  // component's `stopPolling` prop (or `stopPollingRef`) until a re-render
  // that hasn't happened yet, so it can't by itself stop a same-tick
  // `onLimitReached` on the boundary attempt.
  onSuccess?: (result: T | void) => void | boolean
  onError?: (error: unknown) => void
  // Called once, instead of `onError`, if `limit` is hit without `stopPolling`
  // ever being set — a poll loop that never reached a terminal state within
  // its bound (distinct from a transient per-attempt failure, which callers
  // read through `onSuccess`/`onError` themselves and keep polling past).
  onLimitReached?: () => void
  limit?: number
  stopPolling?: boolean
}

export const LongPoll = <T = void,>({
  pollingMethod = noopAsync,
  pollingDelay = 1000,
  onSuccess = noop,
  onError = noop,
  onLimitReached = noop,
  limit = 0,
  stopPolling = false,
}: LongPollProps<T>): null => {
  const timeoutIdRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const countRef = useRef(0)
  const stopPollingRef = useRef(stopPolling)
  const pollingDelayRef = useRef(pollingDelay)
  const pollingMethodRef = useRef(pollingMethod)
  const onSuccessRef = useRef(onSuccess)
  const onErrorRef = useRef(onError)
  const onLimitReachedRef = useRef(onLimitReached)

  useEffect(() => {
    stopPollingRef.current = stopPolling
    pollingDelayRef.current = pollingDelay
    pollingMethodRef.current = pollingMethod
    onSuccessRef.current = onSuccess
    onErrorRef.current = onError
    onLimitReachedRef.current = onLimitReached
  }, [
    stopPolling,
    pollingDelay,
    pollingMethod,
    onSuccess,
    onError,
    onLimitReached,
  ])

  useEffect(() => {
    if (stopPolling || (limit && countRef.current >= limit)) {
      if (timeoutIdRef.current) {
        clearTimeout(timeoutIdRef.current)
        timeoutIdRef.current = null
      }
    }
  }, [stopPolling, limit])

  useEffect(() => {
    return () => {
      if (timeoutIdRef.current) {
        clearTimeout(timeoutIdRef.current)
        timeoutIdRef.current = null
      }
    }
  }, [])

  useSingleEffect(() => {
    const poll = async () => {
      let resolvedTerminal = false
      try {
        const result = await pollingMethodRef.current()
        if (result) {
          resolvedTerminal = onSuccessRef.current(result) === true
        } else {
          onErrorRef.current(result)
        }
      } catch (error) {
        onErrorRef.current(error)
      }

      countRef.current += 1

      // A terminal result this tick wins outright, even on the exact
      // attempt that also exhausts `limit` -- see `onSuccess`'s doc comment.
      if (resolvedTerminal || stopPollingRef.current) {
        return
      }

      const limitReached = Boolean(limit) && countRef.current >= limit
      if (!limitReached) {
        timeoutIdRef.current = setTimeout(poll, pollingDelayRef.current)
      } else {
        onLimitReachedRef.current()
      }
    }

    poll()
  }, [])

  return null
}
