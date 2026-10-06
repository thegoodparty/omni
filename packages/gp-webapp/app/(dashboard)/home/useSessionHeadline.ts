import { useSyncExternalStore } from 'react'
import { useAuth } from '@clerk/nextjs'
import { HOME_HEADLINES } from './nextThingCopy'

const STORAGE_KEY = 'home-headline'

interface StoredHeadline {
  sessionId: string
  headline: string
}

const isHeadline = (value: unknown): value is string =>
  typeof value === 'string' &&
  (HOME_HEADLINES as readonly string[]).includes(value)

const readStored = (): StoredHeadline | null => {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    const parsed: unknown = raw ? JSON.parse(raw) : null
    if (
      parsed &&
      typeof parsed === 'object' &&
      'sessionId' in parsed &&
      'headline' in parsed &&
      typeof parsed.sessionId === 'string' &&
      isHeadline(parsed.headline)
    ) {
      return { sessionId: parsed.sessionId, headline: parsed.headline }
    }
  } catch {}
  return null
}

// One line per login session: every tab of the same sign-in shows the same
// line, and signing in again picks a new one, never the line just shown.
// Kept in memory too, so storage that is blocked still gives a stable line.
const picked = new Map<string, string>()

const pickFor = (sessionId: string): string => {
  const cached = picked.get(sessionId)
  if (cached) return cached

  const stored = readStored()
  if (stored?.sessionId === sessionId) {
    picked.set(sessionId, stored.headline)
    return stored.headline
  }

  const choices = HOME_HEADLINES.filter((line) => line !== stored?.headline)
  const next =
    choices[Math.floor(Math.random() * choices.length)] ?? HOME_HEADLINES[0]
  try {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ sessionId, headline: next }),
    )
  } catch {}
  picked.set(sessionId, next)
  return next
}

// Nothing to subscribe to: the line never changes within a login session.
const subscribe = (): (() => void) => () => undefined

// The server can't know the session's line, so it renders none and the client
// fills it in on hydration; a random pick on both sides would mismatch.
export const useSessionHeadline = (): string | null => {
  const { isLoaded, sessionId } = useAuth()
  return useSyncExternalStore(
    subscribe,
    () => (isLoaded ? pickFor(sessionId ?? 'signed-out') : null),
    () => null,
  )
}
