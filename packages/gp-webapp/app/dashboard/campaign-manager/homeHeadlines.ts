import { useEffect, useState } from 'react'

// Home's headline: a short line of encouragement in GoodParty's own voice
// (independent, people first, in it together) instead of a greeting. It
// cheers the candidate on rather than telling them what to do, and stays
// general so it reads right above whatever the next step is.
export const HOME_HEADLINES = [
  // You've got this
  "You've got this",
  "You're not alone",
  "You're making a difference",
  'This is your race',
  'Your neighbors are with you',
  // We're in it together
  "Let's win this",
  "Let's keep going",
  "We're in this together",
  'Momentum is building',
  // Every vote, every voice
  'Earn every vote',
  'Every vote counts',
  'Every voice matters',
  'Every door matters',
  'One voter at a time',
  // People over parties
  'People over parties',
  'People over money',
  'People over politics',
  'Proudly independent',
  // Local
  'Change starts locally',
  'Local voices matter',
  'For your community',
  'Democracy needs you',
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
