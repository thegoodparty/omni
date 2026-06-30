'use client'

import { useQuery } from '@tanstack/react-query'
import { clientRequest } from 'gpApi/typed-request'
import type { CampaignStory } from '@goodparty_org/contracts'

const STORY_ROUTE = 'GET /v1/campaigns/mine/story' as const

// One source of truth for "has content" — same trim semantics as the gp-api
// ingress trim, so the client gate and the server agree on what counts.
export const isStoryFieldAnswered = (value?: string | null): boolean =>
  !!value?.trim()

// The story is "complete" once both prompts have non-whitespace text AND the
// candidate has at least one issue — the gate for offering campaign-plan
// generation. Issues no longer live on the story: they're the website issues
// shared with the Pro-upgrade flow, so `hasIssues` is passed in. Type guard so
// callers narrow away `undefined` after the check.
export const isCampaignStoryComplete = (
  story: CampaignStory | undefined,
  hasIssues: boolean,
): story is CampaignStory =>
  isStoryFieldAnswered(story?.why) &&
  isStoryFieldAnswered(story?.background) &&
  hasIssues

interface UseCampaignStoryResult {
  data: CampaignStory | undefined
  // True once the fetch has failed (after retries) — lets callers distinguish a
  // real error from "still loading" instead of spinning forever.
  isError: boolean
}

export const useCampaignStory = (
  initialData?: CampaignStory,
): UseCampaignStoryResult => {
  const query = useQuery({
    queryKey: ['campaign-story', 'mine'],
    queryFn: () => clientRequest(STORY_ROUTE, {}).then((res) => res.data),
    initialData,
    // Always refetch on mount: a user who just finished their story on the
    // story page then opens the plan tab must see the completed state, and
    // autosave writes don't touch this query's cache.
    refetchOnMount: 'always',
  })
  return { data: query.data, isError: query.isError }
}
