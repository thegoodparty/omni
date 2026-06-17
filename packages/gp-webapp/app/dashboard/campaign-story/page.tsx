import pageMetaData from 'helpers/metadataHelper'
import { serverRequest } from 'gpApi/server-request'
import type { CampaignStory } from '@goodparty_org/contracts'
import candidateAccess from '../shared/candidateAccess'
import CampaignStoryPage from './components/CampaignStoryPage'

const meta = pageMetaData({
  title: 'Campaign Story | GoodParty.org',
  description: 'Your why, your background, and the issues you will fight for.',
  slug: '/dashboard/campaign-story',
})

export const metadata = meta
export const dynamic = 'force-dynamic'

const EMPTY_STORY: CampaignStory = { why: null, background: null, issues: null }

const fetchStory = async (): Promise<CampaignStory> => {
  try {
    const { data } = await serverRequest('GET /v1/campaigns/mine/story', {})
    return data
  } catch {
    return EMPTY_STORY
  }
}

export default async function Page(): Promise<React.JSX.Element> {
  await candidateAccess()
  const initialStory = await fetchStory()
  return (
    <CampaignStoryPage
      pathname="/dashboard/campaign-story"
      initialStory={initialStory}
    />
  )
}
