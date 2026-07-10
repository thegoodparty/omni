'use client'

import { useQuery } from '@tanstack/react-query'
import {
  getUserWebsite,
  USER_WEBSITE_QUERY_KEY,
} from 'app/dashboard/website/util/website.util'
import { getBioPlainLength } from 'app/dashboard/profile/texting-compliance/candidate-profile/candidateProfile.utils'
import { isCampaignStoryComplete, useCampaignStory } from './useCampaignStory'

interface UseCampaignStoryCompleteResult {
  isComplete: boolean
  // The story + website the check needs are still resolving. Callers should
  // wait rather than treating "not complete yet" as "incomplete".
  isLoading: boolean
  isError: boolean
}

// Whether the Campaign Story is complete enough to drive plan + tracker
// generation: a why (website bio) + a background (the story row) + at least one
// issue. Mirrors CampaignPlanStoryGate's own gate — fail-open on a website-fetch
// error (don't block a candidate who has a real story) and fail-closed on a
// story error (an errored story leaves data undefined forever). `enabled` gates
// the fetches so the non-story cohort never triggers them.
export const useCampaignStoryComplete = (
  enabled: boolean,
): UseCampaignStoryCompleteResult => {
  const { data: story, isError: storyIsError } = useCampaignStory(
    undefined,
    enabled,
  )
  const {
    data: website,
    isLoading: websiteLoading,
    isError: websiteIsError,
  } = useQuery({
    queryKey: USER_WEBSITE_QUERY_KEY,
    queryFn: getUserWebsite,
    enabled,
    refetchOnMount: 'always',
  })
  const bio = website?.content?.about?.bio ?? ''
  const issues = website?.content?.about?.issues ?? []
  const isLoading =
    enabled &&
    ((story === undefined && !storyIsError) ||
      (websiteLoading && !websiteIsError))
  return {
    isComplete: isCampaignStoryComplete(
      story,
      websiteIsError || getBioPlainLength(bio) > 0,
      websiteIsError || issues.length > 0,
    ),
    isLoading,
    isError: storyIsError,
  }
}
