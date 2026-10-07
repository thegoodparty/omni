import { useEffect, useRef, useState } from 'react'

// Home's headline, the one line above the next-step card. Half the set leads
// straight into the card (the card is what's next, so nothing else needs to
// say so); half cheers the candidate on in GoodParty's own voice. Either kind
// can be an instruction. None claims something we cannot know about their race.
export const HOME_HEADLINES = [
  // Leads into the card
  'Here’s your next move',
  'Up next',
  'Let’s knock this one out',
  'One step closer',
  'Next on your list',
  'Keep it moving',
  'Let’s get this done',
  'Earn every vote',
  'Get into office',
  // Cheers them on
  'You’ve got this',
  'You’re not alone',
  'This is your race',
  'Let’s win this',
  'Let’s keep going',
  'We’re in this together',
  'Every vote counts',
  'Every voice matters',
  'One voter at a time',
  'People over parties',
  'People over money',
  'People over politics',
  'Proudly independent',
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
