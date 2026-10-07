import { useEffect, useRef, useState } from 'react'

// Home's headline: a short line of encouragement in GoodParty's own voice
// (independent, people first, in it together) instead of a greeting. It
// cheers the candidate on rather than telling them what to do, never claims
// something we cannot know about their race, and stays general so it reads
// right above whatever the next step is.
export const HOME_HEADLINES = [
  // You've got this
  "You've got this",
  "You're not alone",
  'This is your race',
  // We're in it together
  "Let's win this",
  "Let's keep going",
  "We're in this together",
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
const SEEN_KEY = 'home-headlines-seen'

const read = (storage: Storage, key: string): string | null => {
  try {
    return storage.getItem(key)
  } catch {
    return null
  }
}

const write = (storage: Storage, key: string, value: string): void => {
  try {
    storage.setItem(key, value)
  } catch {}
}

const readSeen = (): string[] => {
  try {
    const parsed: unknown = JSON.parse(
      read(window.sessionStorage, SEEN_KEY) ?? '[]',
    )
    return Array.isArray(parsed)
      ? parsed.filter((line): line is string => typeof line === 'string')
      : []
  } catch {
    return []
  }
}

// A line not yet shown this session, so a candidate going back and forth
// sees each one before any repeats. Once all have been shown the session
// starts over, and even then never with the line just seen, which is also
// remembered across tabs and sign-ins.
export const pickHomeHeadline = (): string => {
  const last = read(window.localStorage, LAST_KEY)
  let seen = readSeen()
  let choices = HOME_HEADLINES.filter(
    (line) => !seen.includes(line) && line !== last,
  )
  if (choices.length === 0) {
    seen = []
    choices = HOME_HEADLINES.filter((line) => line !== last)
  }
  const next =
    choices[Math.floor(Math.random() * choices.length)] ?? HOME_HEADLINES[0]
  write(window.localStorage, LAST_KEY, next)
  write(window.sessionStorage, SEEN_KEY, JSON.stringify([...seen, next]))
  return next
}

/**
 * A new mission line on every visit to Home, none repeated within a session
 * until all have been shown. Most candidates open Home once or twice a day
 * (Amplitude, Sept 2026). Picked after mount, because the server can't know
 * what was shown; a pick on both sides would mismatch on hydration.
 */
export const useHomeHeadline = (): string | null => {
  const [headline, setHeadline] = useState<string | null>(null)
  // React's dev double mount runs the effect twice; one visit spends one line.
  const picked = useRef<string | null>(null)
  useEffect(() => {
    picked.current ??= pickHomeHeadline()
    setHeadline(picked.current)
  }, [])
  return headline
}
