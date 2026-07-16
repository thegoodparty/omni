'use client'
import { useRef, useState } from 'react'

export const useLocalStorage = <T>(
  key: string,
  initialValue: T,
): [T, (value: T | ((val: T) => T)) => void] => {
  const localStorage =
    typeof window !== 'undefined' ? window.localStorage : null
  const [state, setState] = useState<T>(() => {
    try {
      const value = localStorage?.getItem(key)
      return value ? JSON.parse(value) : initialValue
    } catch (error) {
      console.log(error)
      return initialValue
    }
  })
  // Functional updaters must compose within one batch like useState's do,
  // but the render-time `state` closure is stale for the second update in
  // a batch. Resolve updaters against a ref holding the latest value so
  // state and localStorage stay in lockstep — without side effects inside
  // a setState updater, which must stay pure under StrictMode.
  const latestRef = useRef(state)

  const setValue = (value: T | ((val: T) => T)): void => {
    try {
      const valueToStore =
        value instanceof Function ? value(latestRef.current) : value
      latestRef.current = valueToStore
      localStorage?.setItem(key, JSON.stringify(valueToStore))
      setState(valueToStore)
    } catch (error) {
      console.log(error)
    }
  }

  return [state, setValue]
}
