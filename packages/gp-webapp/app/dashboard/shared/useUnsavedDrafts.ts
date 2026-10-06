import { useState } from 'react'

export interface UnsavedDrafts<T> {
  get: (key: string) => T | undefined
  set: (key: string, draft: T) => void
  clear: (key: string) => void
}

// Answers a form was given and never saved, kept by the page that owns the
// session so a form remounted for another person can hand them back. In
// memory only: a reload is a fresh session, and a person's answers have no
// business outliving it in the browser.
export const useUnsavedDrafts = <T>(): UnsavedDrafts<T> => {
  const [drafts] = useState<UnsavedDrafts<T>>(() => {
    const store = new Map<string, T>()
    return {
      get: (key) => store.get(key),
      set: (key, draft) => {
        store.set(key, draft)
      },
      clear: (key) => {
        store.delete(key)
      },
    }
  })
  return drafts
}
