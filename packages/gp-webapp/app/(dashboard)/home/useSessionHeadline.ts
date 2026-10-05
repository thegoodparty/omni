import { useSyncExternalStore } from 'react'
import { HOME_HEADLINES } from './nextThingCopy'

const STORAGE_KEY = 'home-headline'

// Picked once per browser session and kept in sessionStorage, so a reload
// keeps the line and a new tab or a return visit gets a fresh one. Kept in
// memory too, for when storage is blocked.
let picked: string | null = null

const pick = (): string => {
  if (picked) return picked
  try {
    const stored = window.sessionStorage.getItem(STORAGE_KEY)
    if (stored && (HOME_HEADLINES as readonly string[]).includes(stored)) {
      picked = stored
      return stored
    }
  } catch {}
  const next =
    HOME_HEADLINES[Math.floor(Math.random() * HOME_HEADLINES.length)] ??
    HOME_HEADLINES[0]
  try {
    window.sessionStorage.setItem(STORAGE_KEY, next)
  } catch {}
  picked = next
  return next
}

// Nothing to subscribe to: the line never changes within a session.
const subscribe = (): (() => void) => () => undefined

// The server can't know the session's line, so it renders none and the client
// fills it in on hydration; a random pick on both sides would mismatch.
export const useSessionHeadline = (): string | null =>
  useSyncExternalStore(subscribe, pick, () => null)
