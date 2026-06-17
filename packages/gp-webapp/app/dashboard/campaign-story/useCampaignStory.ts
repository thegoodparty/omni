'use client'

import { useQuery } from '@tanstack/react-query'
import { clientRequest } from 'gpApi/typed-request'
import type { CampaignStory } from '@goodparty_org/contracts'

const STORY_ROUTE = 'GET /v1/campaigns/mine/story' as const

// The story is "complete" once all three prompts have non-whitespace text —
// the gate for offering campaign-plan generation.
export const isCampaignStoryComplete = (
  story: CampaignStory | undefined,
): boolean =>
  !!story?.why?.trim() && !!story?.background?.trim() && !!story?.issues?.trim()

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
