import { useEffect, useState } from 'react'
import { HOME_HEADLINES } from './nextThingCopy'

const LAST_KEY = 'home-headline-last'

const readLast = (): string | null => {
  try {
    return window.localStorage.getItem(LAST_KEY)
  } catch {
    return null
  }
}

// A new line, never the one shown last, so coming back to Home always reads
// fresh. Remembered across tabs and sign-ins only to rule out a repeat.
export const pickHomeHeadline = (): string => {
  const last = readLast()
  const choices = HOME_HEADLINES.filter((line) => line !== last)
  const next =
    choices[Math.floor(Math.random() * choices.length)] ?? HOME_HEADLINES[0]
  try {
    window.localStorage.setItem(LAST_KEY, next)
  } catch {}
  return next
}

/**
 * Home's headline: a new mission line on every visit. Most candidates open
 * Home once or twice a day, so it changes without ever churning. Picked after
 * mount, because the server can't know the last line; a pick on both sides
 * would mismatch on hydration.
 */
export const useHomeHeadline = (): string | null => {
  const [headline, setHeadline] = useState<string | null>(null)
  useEffect(() => {
    setHeadline(pickHomeHeadline())
  }, [])
  return headline
}
