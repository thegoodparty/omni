'use client'

import { useEffect, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { stripHtml } from 'string-strip-html'
import { clientRequest } from 'gpApi/typed-request'
import { reportErrorToSentry } from '@shared/sentry'
import type { WebsiteIssue } from 'helpers/types'
import {
  getUserWebsite,
  saveAboutFields,
  USER_WEBSITE_QUERY_KEY,
} from 'app/dashboard/website/util/website.util'
import { useCampaignStory } from 'app/dashboard/campaign-story/useCampaignStory'

export interface OnboardingStoryDraft {
  // True once both the website + story fetches have resolved (or errored) so the
  // draft has been seeded and is safe to edit.
  isReady: boolean
  isError: boolean
  why: string
  background: string
  issues: WebsiteIssue[]
  setWhy: (value: string) => void
  setBackground: (value: string) => void
  setIssues: (value: WebsiteIssue[]) => void
  // "Complete" once all three are answered — the gate for firing plan generation
  // when the candidate finishes (rather than skips) the story.
  isComplete: boolean
  // Persists all three at once (bio + issues on the website, background on the
  // story). Called only on the final story step's Continue. Returns success.
  persist: () => Promise<boolean>
}

// Holds the onboarding Campaign Story answers in memory across the three story
// steps (why / background / issues) and defers persistence until the final
// step. The why is edited as plain text and stored as the website bio; a
// returning candidate's HTML bio is stripped to plain for the textarea (the
// toolbar was hidden in the old card anyway). `enabled` gates the fetches to the
// story cohort so the non-story flow never triggers them.
export const useOnboardingStoryDraft = (
  enabled: boolean,
): OnboardingStoryDraft => {
  const { data: website, isError: isWebsiteError } = useQuery({
    queryKey: USER_WEBSITE_QUERY_KEY,
    queryFn: getUserWebsite,
    enabled,
    refetchOnMount: 'always',
  })
  const { data: story, isError: isStoryError } = useCampaignStory(
    undefined,
    enabled,
  )

  const [why, setWhy] = useState('')
  const [background, setBackground] = useState('')
  const [issues, setIssues] = useState<WebsiteIssue[]>([])
  // Seed the editable draft from the fetched values exactly once, so a refetch
  // (or a re-render) can't clobber in-progress edits.
  const seededRef = useRef(false)

  const isError = isWebsiteError || isStoryError
  const isReady =
    enabled &&
    (website !== undefined || isWebsiteError) &&
    (story !== undefined || isStoryError)

  useEffect(() => {
    if (!enabled || seededRef.current || !isReady) return
    seededRef.current = true
    const bio = website?.content?.about?.bio ?? ''
    setWhy(bio ? stripHtml(bio).result.trim() : '')
    setBackground(story?.background ?? '')
    setIssues(website?.content?.about?.issues ?? [])
  }, [enabled, isReady, website, story])

  const isComplete =
    why.trim().length > 0 && background.trim().length > 0 && issues.length > 0

  const persist = async (): Promise<boolean> => {
    const okAbout = await saveAboutFields({ bio: why, issues })
    let okStory = true
    try {
      await clientRequest('PUT /v1/campaigns/mine/story', { background })
    } catch (error) {
      okStory = false
      reportErrorToSentry(error, { context: 'useOnboardingStoryDraft.persist' })
    }
    return okAbout && okStory
  }

  return {
    isReady,
    isError,
    why,
    background,
    issues,
    setWhy,
    setBackground,
    setIssues,
    isComplete,
    persist,
  }
}
