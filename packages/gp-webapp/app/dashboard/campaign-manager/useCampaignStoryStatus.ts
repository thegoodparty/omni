'use client'

import { useQuery } from '@tanstack/react-query'
import {
  getUserWebsite,
  USER_WEBSITE_QUERY_KEY,
} from 'app/dashboard/website/util/website.util'
import { getBioPlainLength } from 'app/dashboard/profile/texting-compliance/candidate-profile/candidateProfile.utils'
import {
  isStoryFieldAnswered,
  useCampaignStory,
} from '../campaign-story/useCampaignStory'
import type { StoryField } from './campaignManagerChat'

interface CampaignStoryStatus {
  // False until both the story and the website have loaded, so the opener never
  // flashes the intake at someone whose story is actually complete.
  ready: boolean
  missing: StoryField[]
}

// Client-side Campaign Story completeness for the manager home, using the same
// three gates the Story page uses: why = website bio, background = story field,
// positions = website issues. Reading the same sources keeps the manager's
// opener in agreement with the Story page and the generation gate.
export const useCampaignStoryStatus = (): CampaignStoryStatus => {
  const { data: story } = useCampaignStory()
  const { data: website } = useQuery({
    queryKey: USER_WEBSITE_QUERY_KEY,
    queryFn: getUserWebsite,
  })

  const ready = story !== undefined && website !== undefined
  const about = website?.content?.about
  const missing: StoryField[] = []
  if (getBioPlainLength(about?.bio) === 0) missing.push('why')
  if (!isStoryFieldAnswered(story?.background)) missing.push('background')
  if ((about?.issues ?? []).length === 0) missing.push('positions')

  return { ready, missing }
}
