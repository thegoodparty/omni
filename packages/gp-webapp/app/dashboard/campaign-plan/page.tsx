import pageMetaData from 'helpers/metadataHelper'
import candidateAccess from '../shared/candidateAccess'
import { getServerUser } from 'helpers/userServerHelper'
import { fetchUserCampaign } from 'app/onboarding/shared/getCampaign'
import { redirect } from 'next/navigation'
import CampaignPlanPage from './components/CampaignPlanPage'

const meta = pageMetaData({
  title: 'Campaign Plan | GoodParty.org',
  description: 'Your AI-generated campaign plan.',
  slug: '/dashboard/campaign-plan',
})

export const metadata = meta
export const dynamic = 'force-dynamic'

export default async function Page(): Promise<React.JSX.Element> {
  await candidateAccess()
  const [initialUser, campaign] = await Promise.all([
    getServerUser(),
    fetchUserCampaign(),
  ])
  // Don't show to users who haven't set up a campaign strategy during onboarding yet.
  // The contract types the field as optional — only an explicit true grants access.
  if (campaign?.hasCampaignStrategy !== true) {
    redirect('/dashboard')
  }
  return <CampaignPlanPage initialUser={initialUser} />
}
