import { auth } from '@clerk/nextjs/server'
import { redirect } from 'next/navigation'
import pageMetaData from 'helpers/metadataHelper'
import { getServerUser } from 'helpers/userServerHelper'
import { fetchUserCampaign } from 'app/onboarding/shared/getCampaign'
import AccountProfilePage from './components/AccountProfilePage'

const meta = pageMetaData({
  title: 'Account',
  description: 'Manage your account on GoodParty.org.',
})
export const metadata = meta

export const dynamic = 'force-dynamic'

const Page = async (): Promise<React.JSX.Element> => {
  const { userId } = await auth()
  if (!userId) {
    redirect('/login')
  }

  const user = await getServerUser()
  if (!user) {
    throw new Error('Failed to load your account. Please try again.')
  }

  const campaign = await fetchUserCampaign()
  const { subscriptionCancelAt, subscriptionId } = campaign?.details || {}

  return (
    <AccountProfilePage
      user={user}
      campaign={campaign}
      isPro={Boolean(campaign?.isPro)}
      subscriptionCancelAt={subscriptionCancelAt}
      subscriptionId={subscriptionId}
    />
  )
}

export default Page
