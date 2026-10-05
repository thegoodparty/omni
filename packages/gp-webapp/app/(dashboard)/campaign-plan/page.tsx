import pageMetaData from 'helpers/metadataHelper'
import candidateAccess from '../shared/candidateAccess'
import { getServerUser } from 'helpers/userServerHelper'
import CampaignPlanRouter from './components/CampaignPlanRouter'

const meta = pageMetaData({
  title: 'Campaign Plan | GoodParty.org',
  description: 'Your AI-generated campaign plan.',
  slug: '/campaign-plan',
})

export const metadata = meta
export const dynamic = 'force-dynamic'

export default async function Page(): Promise<React.JSX.Element> {
  await candidateAccess()
  const initialUser = await getServerUser()
  return <CampaignPlanRouter initialUser={initialUser} />
}
