import { noop, noopAsync } from './noop'
import { useEffect, useRef } from 'react'
import { useSingleEffect } from '@shared/hooks/useSingleEffect'

interface LongPollProps<T = void> {
  pollingMethod?: () => Promise<T | void>
  pollingDelay?: number
  onSuccess?: (result: T | void) => void
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
      try {
        const result = await pollingMethodRef.current()
        if (result) {
          onSuccessRef.current(result)
        } else {
          onErrorRef.current(result)
        }
      } catch (error) {
        onErrorRef.current(error)
      }

      countRef.current += 1

      const limitReached = Boolean(limit) && countRef.current >= limit
      if (!stopPollingRef.current && !limitReached) {
        timeoutIdRef.current = setTimeout(poll, pollingDelayRef.current)
      } else if (limitReached && !stopPollingRef.current) {
        onLimitReachedRef.current()
      }
    }

    poll()
  }, [])

  return null
}
