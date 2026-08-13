import { fetchUserCampaign } from 'app/onboarding/shared/getCampaign'
import pageMetaData from 'helpers/metadataHelper'
import candidateAccess from '../shared/candidateAccess'
import DetailsPage from 'app/dashboard/campaign-details/components/DetailsPage'
import { getServerUser } from 'helpers/userServerHelper'

const meta = pageMetaData({
  title: 'Profile | GoodParty.org',
  description: 'Manage your public profile on GoodParty.org.',
  slug: '/dashboard/profile',
})
export const metadata = meta

export const dynamic = 'force-dynamic'

export default async function Page(): Promise<React.JSX.Element> {
  await candidateAccess()

  const campaign = await fetchUserCampaign()
  const user = await getServerUser()

  return (
    <DetailsPage
      pathname="/dashboard/profile"
      campaign={campaign ?? undefined}
      user={user}
    />
  )
}
