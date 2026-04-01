import { useCallback, useEffect, useRef } from 'react'

export function useDebouncedCallback<T extends (...args: never[]) => void>(
  callback: T,
  delay: number
): (...args: Parameters<T>) => void {
  const callbackRef = useRef(callback)

  useEffect(() => {
    callbackRef.current = callback
  })

  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  return useCallback(
    (...args: Parameters<T>) => {
      clearTimeout(timerRef.current)
      timerRef.current = setTimeout(() => callbackRef.current(...args), delay)
    },
    [delay]
  )
}
