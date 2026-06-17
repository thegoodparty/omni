import pageMetaData from 'helpers/metadataHelper'
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
  return <CampaignStoryPage pathname="/dashboard/campaign-story" />
}
