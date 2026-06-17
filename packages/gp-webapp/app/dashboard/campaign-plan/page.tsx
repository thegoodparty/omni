import pageMetaData from 'helpers/metadataHelper'
import candidateAccess from '../shared/candidateAccess'
import { getServerUser } from 'helpers/userServerHelper'
import { serverRequest } from 'gpApi/server-request'
import CampaignPlanRouter from './components/CampaignPlanRouter'

// Same source of truth as the sidebar tab (useCampaignStrategyExists): the
// dedicated existence endpoint, not a field on the campaign payload. Returns
// null (not false) on error so the router can tell "confirmed no plan" apart
// from "unknown" — treating an error as "no plan" would offer a plan-holder
// the regenerate gate and let them overwrite an existing plan.
const strategyExists = async (): Promise<boolean | null> => {
  try {
    const res = await serverRequest('GET /v1/campaignStrategy/mine/exists', {})
    return res.data.exists === true
  } catch {
    return null
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
  const [initialUser, planExists] = await Promise.all([
    getServerUser(),
    strategyExists(),
  ])
  return (
    <CampaignPlanRouter initialUser={initialUser} planExists={planExists} />
  )
}
