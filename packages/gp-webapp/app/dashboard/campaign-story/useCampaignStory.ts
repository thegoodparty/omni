'use client'

import { useQuery } from '@tanstack/react-query'
import { clientRequest } from 'gpApi/typed-request'
import type { CampaignStory } from '@goodparty_org/contracts'

const STORY_ROUTE = 'GET /v1/campaigns/mine/story' as const

// One source of truth for "has content" — same trim semantics as the gp-api
// ingress trim, so the client gate and the server agree on what counts.
export const isStoryFieldAnswered = (value?: string | null): boolean =>
  !!value?.trim()

// The story is "complete" once all three prompts have non-whitespace text —
// the gate for offering campaign-plan generation.
export const isCampaignStoryComplete = (
  story: CampaignStory | undefined,
): boolean =>
  isStoryFieldAnswered(story?.why) &&
  isStoryFieldAnswered(story?.background) &&
  isStoryFieldAnswered(story?.issues)

export const useCampaignStory = (
  initialData?: CampaignStory,
): CampaignStory | undefined => {
  const query = useQuery({
    queryKey: ['campaign-story', 'mine'],
    queryFn: () => clientRequest(STORY_ROUTE, {}).then((res) => res.data),
    initialData,
    // Always refetch on mount: a user who just finished their story on the
    // story page then opens the plan tab must see the completed state, and
    // autosave writes don't touch this query's cache.
    refetchOnMount: 'always',
  })
  return query.data
}
