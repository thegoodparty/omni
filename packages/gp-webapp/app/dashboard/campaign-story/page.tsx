import pageMetaData from 'helpers/metadataHelper'
import { serverRequest } from 'gpApi/server-request'
import { fetchUserWebsite } from 'helpers/fetchUserWebsite'
import { normalizeIssues } from 'app/dashboard/profile/texting-compliance/candidate-profile/candidateProfile.utils'
import candidateAccess from '../shared/candidateAccess'
import CampaignStoryPage from './components/CampaignStoryPage'

// Same existence check the plan tab + sidebar use. Fails closed to false, so an
// API blip reads as "not generated yet" and the footer keeps offering generate.
const strategyExists = async (): Promise<boolean> => {
  try {
    const res = await serverRequest('GET /v1/campaignStrategy/mine/exists', {})
    return res.data.exists === true
  } catch {
    return false
  }
}

const meta = pageMetaData({
  title: 'Campaign Story | GoodParty.org',
  description: 'Your why, your background, and the issues you will fight for.',
  slug: '/dashboard/campaign-story',
})

export const metadata = meta
export const dynamic = 'force-dynamic'

export default async function Page(): Promise<React.JSX.Element> {
  await candidateAccess()
  // Deliberately not caught: a fetch failure should hit Next's error boundary,
  // not render blank fields a blur autosave could overwrite. The endpoint
  // returns 200 with null fields for a brand-new story, so the empty case is
  // the success path, not an error.
  const { data: initialStory } = await serverRequest(
    'GET /v1/campaigns/mine/story',
    {},
  )
  // The "why" (bio) and issues live on the website (shared with the Pro-upgrade
  // flow), not the story. fetchUserWebsite returns null for a candidate with no
  // site yet — the editors then start empty and create the site on first save.
  // planExists reflects generation kicked off from anywhere (incl. the manager
  // chat); force-dynamic means it's re-read on each navigation to this page.
  const [website, planExists] = await Promise.all([
    fetchUserWebsite(),
    strategyExists(),
  ])
  const initialBio = website?.content?.about?.bio ?? ''
  const initialIssues = normalizeIssues(website?.content?.about?.issues)
  return (
    <CampaignStoryPage
      pathname="/dashboard/campaign-story"
      initialStory={initialStory}
      initialBio={initialBio}
      initialIssues={initialIssues}
      planExists={planExists}
    />
  )
}
