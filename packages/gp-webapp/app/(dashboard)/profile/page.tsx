import { fetchUserCampaign } from 'app/onboarding/shared/getCampaign'
import pageMetaData from 'helpers/metadataHelper'
import candidateAccess from '../shared/candidateAccess'
import DetailsPage from 'app/(dashboard)/campaign-details/components/DetailsPage'
import { getServerUser } from 'helpers/userServerHelper'
import { apiRoutes } from 'gpApi/routes'
import { serverFetch } from 'gpApi/serverFetch'

const meta = pageMetaData({
  title: 'Profile | GoodParty.org',
  description: 'Manage your public profile on GoodParty.org.',
  slug: '/profile',
})
export const metadata = meta

export const dynamic = 'force-dynamic'

export default async function Page(): Promise<React.JSX.Element> {
  await candidateAccess()

  const [campaign, user, electedOffice] = await Promise.all([
    fetchUserCampaign(),
    getServerUser(),
    serverFetch(apiRoutes.electedOffice.current),
  ])
  // Decided here, not in the client, so a candidate never sees the sidebar
  // flash in before the focused page.
  const isServe = !!(electedOffice?.ok && electedOffice.data)

  return (
    <DetailsPage
      pathname="/profile"
      campaign={campaign ?? undefined}
      user={user}
      focused={!isServe}
    />
  )
}
