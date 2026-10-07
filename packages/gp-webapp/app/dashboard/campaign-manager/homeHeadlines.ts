import { useEffect, useState } from 'react'

// Home's headline: a short rallying line in GoodParty's own voice
// (independent, people first, ready to work) instead of a greeting. General on
// purpose, so it reads right above whatever the next step is.
export const HOME_HEADLINES = [
  'Get into office',
  'Run your way',
  'No party required',
  'People over money',
  'Earn every vote',
  'On the trail',
  "You've got this",
  'Ready when you are',
] as const

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
 * A new mission line on every visit to Home. Most candidates open Home once
 * or twice a day (Amplitude, Sept 2026), so it changes without churning.
 * Picked after mount, because the server can't know the last line shown; a
 * pick on both sides would mismatch on hydration.
 */
export const useHomeHeadline = (): string | null => {
  const [headline, setHeadline] = useState<string | null>(null)
  useEffect(() => {
    setHeadline(pickHomeHeadline())
  }, [])
  return headline
}
