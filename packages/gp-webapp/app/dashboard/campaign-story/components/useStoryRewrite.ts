'use client'

import { useEffect, useRef, useState } from 'react'
import { FetchError } from 'ofetch'
import { clientRequest } from 'gpApi/typed-request'
import { reportErrorToSentry } from '@shared/sentry'
import { EVENTS, trackEvent } from 'helpers/analyticsHelper'

// The Campaign Story prompts that support "Improve with AI". `why` edits the
// website bio (shared with Pro-upgrade), `background` stays on the story, and
// `issue` rewrites a single policy's description — all through the same
// stateless endpoint.
export type StoryRewriteField = 'why' | 'background' | 'issue'

export interface StoryRewrite {
  isRewriting: boolean
  rewriteError: boolean
  limitReached: boolean
  // True once an AI improvement has been applied and not yet undone — the cue to
  // show the "Undo" link. Stays until the candidate undoes it or runs another
  // improvement (which recaptures the baseline).
  canUndo: boolean
  requestRewrite: () => Promise<void>
  undo: () => void
}

// Shared "Improve with AI" logic for the story prompts. On success the improved
// text is applied straight to the field via `onImproved` — there is no
// suggestion panel. The pre-improvement text is kept so "Undo" can restore it
// (reusing the same `onImproved` to write it back). The caller owns the editor:
// `onImproved` applies the given text to its field and persists it, since a
// button click may leave no blur to trigger the autosave. Analytics, the
// lifetime-limit 403, and the overlapping-call guard live here so both prompt
// cards behave identically.
export const useStoryRewrite = (
  field: StoryRewriteField,
  text: string,
  onImproved: (text: string) => void,
  // For `issue`, the policy title gives the rewrite extra context (same as the
  // Pro-upgrade PolicyForm). Ignored for why/background.
  title?: string,
): StoryRewrite => {
  const [isRewriting, setIsRewriting] = useState(false)
  const [rewriteError, setRewriteError] = useState(false)
  // Set on a 403 — the campaign hit its lifetime AI rewrite cap. Permanent for
  // the session: no point retrying.
  const [limitReached, setLimitReached] = useState(false)
  const [canUndo, setCanUndo] = useState(false)
  // The field text captured just before the last applied improvement, restored
  // verbatim on undo.
  const originalRef = useRef('')
  // Guards against overlapping rewrite calls (e.g. a double-click landing before
  // the disabled state re-renders).
  const rewritingRef = useRef(false)
  // A rewrite request may resolve after the card unmounts (e.g. a "Start over"
  // that remounts the cards while a rewrite is in flight). Don't apply the AI
  // text in that case — it would write back into a just-cleared field.
  const mountedRef = useRef(true)
  useEffect(
    () => () => {
      mountedRef.current = false
    },
    [],
  )

  const requestRewrite = async (): Promise<void> => {
    const trimmed = text.trim()
    if (!trimmed || rewritingRef.current || limitReached) return
    rewritingRef.current = true
    setIsRewriting(true)
    setRewriteError(false)
    trackEvent(EVENTS.CampaignStory.RewriteRequested, {
      field,
      source: 'initial',
    })
    try {
      const trimmedTitle = title?.trim()
      // Capture the undo baseline before the async call — `text` is the value
      // the user saw when they clicked, and reading it here keeps it independent
      // of anything that lands during the round-trip.
      originalRef.current = text
      const { data } = await clientRequest(
        'POST /v1/campaigns/mine/story/rewrite',
        {
          field,
          text: trimmed,
          ...(trimmedTitle ? { title: trimmedTitle } : {}),
        },
      )
      if (!mountedRef.current) return
      onImproved(data.rewrite)
      setCanUndo(true)
      trackEvent(EVENTS.CampaignStory.RewriteAccepted, { field })
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

  const undo = (): void => {
    if (!canUndo) return
    trackEvent(EVENTS.CampaignStory.RewriteDiscarded, { field })
    onImproved(originalRef.current)
    setCanUndo(false)
  }

  return {
    isRewriting,
    rewriteError,
    limitReached,
    canUndo,
    requestRewrite,
    undo,
  }
}
