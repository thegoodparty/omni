import pageMetaData from 'helpers/metadataHelper'
import candidateAccess from '../../shared/candidateAccess'
import CampaignTrackerPage from '../components/CampaignTrackerPage'

const meta = pageMetaData({
  title: 'Campaign Tracker | GoodParty.org',
  description: 'Everything you need to do for your campaign, in order.',
  slug: '/dashboard/campaign-plan/tracker',
})

export const metadata = meta
export const dynamic = 'force-dynamic'

export default async function Page(): Promise<React.JSX.Element> {
  await candidateAccess()
  return <CampaignTrackerPage />
}
