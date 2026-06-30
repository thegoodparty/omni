'use client'

import { useRef, useState } from 'react'
import { FetchError } from 'ofetch'
import { clientRequest } from 'gpApi/typed-request'
import { reportErrorToSentry } from '@shared/sentry'
import { EVENTS, trackEvent } from 'helpers/analyticsHelper'

// The Campaign Story prompts that support AI "Help me rewrite". `why` now edits
// the website bio (shared with Pro-upgrade) while `background` stays on the
// story, but both rewrite through the same stateless endpoint.
export type StoryRewriteField = 'why' | 'background'

export interface StoryRewrite {
  isRewriting: boolean
  rewrite: string | null
  rewriteError: boolean
  limitReached: boolean
  // True while a suggestion is being generated, shown, or errored — the cue to
  // render the suggestion card and hide the "Help me rewrite" button.
  rewriteActive: boolean
  requestRewrite: (source: 'initial' | 'retry') => Promise<void>
  discard: () => void
  accept: () => void
}

// Shared "Help me rewrite" logic for the story prompts. The caller owns the
// editor: it passes the current plain text and an `onAccept` that applies the
// accepted suggestion to its own field and persists it (there may be no blur to
// trigger an autosave). Analytics, the lifetime-limit 403, and the
// overlapping-call guard live here so both prompt cards behave identically.
export const useStoryRewrite = (
  field: StoryRewriteField,
  text: string,
  onAccept: (suggestion: string) => void,
): StoryRewrite => {
  const [rewrite, setRewrite] = useState<string | null>(null)
  const [isRewriting, setIsRewriting] = useState(false)
  const [rewriteError, setRewriteError] = useState(false)
  // Set on a 403 — the campaign hit its lifetime AI rewrite cap. Permanent for
  // the session: no point retrying.
  const [limitReached, setLimitReached] = useState(false)
  // Guards against overlapping rewrite calls (e.g. a double-click landing before
  // the disabled state re-renders), so an older response can't resolve after a
  // newer one and show a stale suggestion.
  const rewritingRef = useRef(false)
  const rewriteActive = isRewriting || rewrite !== null || rewriteError

  const requestRewrite = async (source: 'initial' | 'retry'): Promise<void> => {
    const trimmed = text.trim()
    if (!trimmed || rewritingRef.current || limitReached) return
    rewritingRef.current = true
    setIsRewriting(true)
    setRewriteError(false)
    setRewrite(null)
    trackEvent(EVENTS.CampaignStory.RewriteRequested, { field, source })
    try {
      const { data } = await clientRequest(
        'POST /v1/campaigns/mine/story/rewrite',
        { field, text: trimmed },
      )
      setRewrite(data.rewrite)
    } catch (error) {
      // 403 = campaign hit its lifetime rewrite cap. An expected limit, not an
      // error to report — show the limit notice instead of the generic retry.
      if (error instanceof FetchError && error.status === 403) {
        setLimitReached(true)
        trackEvent(EVENTS.CampaignStory.RewriteLimitReached, { field })
      } else {
        reportErrorToSentry(error, { context: 'useStoryRewrite', field })
        setRewriteError(true)
      }
    } finally {
      rewritingRef.current = false
      setIsRewriting(false)
    }
  }

  const clear = (): void => {
    setRewrite(null)
    setRewriteError(false)
  }

  const discard = (): void => {
    if (rewrite) {
      trackEvent(EVENTS.CampaignStory.RewriteDiscarded, { field })
    }
    clear()
  }

  const accept = (): void => {
    if (!rewrite) return
    trackEvent(EVENTS.CampaignStory.RewriteAccepted, { field })
    const suggestion = rewrite
    clear()
    onAccept(suggestion)
  }

  return {
    isRewriting,
    rewrite,
    rewriteError,
    limitReached,
    rewriteActive,
    requestRewrite,
    discard,
    accept,
  }
}
