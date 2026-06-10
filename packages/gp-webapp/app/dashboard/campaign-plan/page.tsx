import pageMetaData from 'helpers/metadataHelper'
import candidateAccess from '../shared/candidateAccess'
import { getServerUser } from 'helpers/userServerHelper'
import { serverRequest } from 'gpApi/server-request'
import { redirect } from 'next/navigation'
import CampaignPlanPage from './components/CampaignPlanPage'

// Same source of truth as the sidebar tab (useCampaignStrategyExists):
// the dedicated existence endpoint, not a field on the campaign payload.
// Fail closed — an error means we can't prove access, so redirect.
const strategyExists = async (): Promise<boolean> => {
  try {
    const res = await serverRequest('GET /v1/campaignStrategy/mine/exists', {})
    return res.data.exists === true
  } catch {
    return false
  }
}

const meta = pageMetaData({
  title: 'Campaign Plan | GoodParty.org',
  description: 'Your AI-generated campaign plan.',
  slug: '/dashboard/campaign-plan',
})

export const metadata = meta
export const dynamic = 'force-dynamic'

export default async function Page(): Promise<React.JSX.Element> {
  await candidateAccess()
  const [initialUser, exists] = await Promise.all([
    getServerUser(),
    strategyExists(),
  ])
  // Don't show to users who haven't set up a campaign strategy during onboarding yet.
  if (!exists) {
    redirect('/dashboard')
  }
  return <CampaignPlanPage initialUser={initialUser} />
}
