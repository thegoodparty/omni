import pageMetaData from 'helpers/metadataHelper'
import { serverRequest } from 'gpApi/server-request'
import { fetchUserWebsite } from 'helpers/fetchUserWebsite'
import { normalizeIssues } from 'app/dashboard/profile/texting-compliance/candidate-profile/candidateProfile.utils'
import candidateAccess from '../shared/candidateAccess'
import CampaignStoryPage from './components/CampaignStoryPage'

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
  const website = await fetchUserWebsite()
  const initialBio = website?.content?.about?.bio ?? ''
  const initialIssues = normalizeIssues(website?.content?.about?.issues)
  return (
    <CampaignStoryPage
      pathname="/dashboard/campaign-story"
      initialStory={initialStory}
      initialBio={initialBio}
      initialIssues={initialIssues}
    />
  )
}
