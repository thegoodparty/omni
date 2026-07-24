'use client'

import { useEffect, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { stripHtml } from 'string-strip-html'
import { clientRequest } from 'gpApi/typed-request'
import { reportErrorToSentry } from '@shared/sentry'
import type { WebsiteIssue } from 'helpers/types'
import {
  getUserWebsite,
  saveAboutFields,
  USER_WEBSITE_QUERY_KEY,
} from 'app/dashboard/website/util/website.util'
import {
  CAMPAIGN_STORY_QUERY_KEY,
  useCampaignStory,
} from 'app/dashboard/campaign-story/useCampaignStory'

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
  // Per-field persistence, called on that step's Continue. Each writes the
  // field's current value verbatim — including an empty one, so a candidate who
  // clears a field and continues clears the stored value too. Skip persists
  // nothing (the caller just doesn't call these). Returns success.
  persistWhy: () => Promise<boolean>
  persistBackground: () => Promise<boolean>
  persistIssues: () => Promise<boolean>
}

// Holds the onboarding Campaign Story answers in memory across the three story
// steps (why / background / issues) and persists each on its own Continue. The
// why is edited as plain text and stored as the website bio; a returning
// candidate's HTML bio is stripped to plain for the textarea (the toolbar was
// hidden in the old card anyway). `enabled` gates the fetches to the story
// cohort so the non-story flow never triggers them.
export const useOnboardingStoryDraft = (
  enabled: boolean,
): OnboardingStoryDraft => {
  const queryClient = useQueryClient()
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

  // Refresh the shared website cache after a bio/issues write so a later reader
  // within staleTime (notably the Pro-upgrade candidate profile, which seeds
  // its bio + issues from USER_WEBSITE_QUERY_KEY, and the plan-tab story gate)
  // refetches the value we just wrote instead of the pre-write snapshot.
  // Without this the why wouldn't pre-fill in Pro after onboarding.
  const invalidateWebsite = (): void => {
    void queryClient.invalidateQueries({ queryKey: USER_WEBSITE_QUERY_KEY })
  }

  const persistWhy = async (): Promise<boolean> => {
    const ok = await saveAboutFields({ bio: why })
    invalidateWebsite()
    return ok
  }

  const persistIssues = async (): Promise<boolean> => {
    const ok = await saveAboutFields({ issues })
    invalidateWebsite()
    return ok
  }

  const persistBackground = async (): Promise<boolean> => {
    try {
      await clientRequest('PUT /v1/campaigns/mine/story', { background })
    } catch (error) {
      reportErrorToSentry(error, {
        context: 'useOnboardingStoryDraft.persistBackground',
      })
      return false
    }
    void queryClient.invalidateQueries({ queryKey: CAMPAIGN_STORY_QUERY_KEY })
    return true
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
    persistWhy,
    persistBackground,
    persistIssues,
  }
}
