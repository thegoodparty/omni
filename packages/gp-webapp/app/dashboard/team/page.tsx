import { auth } from '@clerk/nextjs/server'
import { redirect } from 'next/navigation'
import pageMetaData from 'helpers/metadataHelper'
import FeatureFlagGuard from '@shared/experiments/FeatureFlagGuard'
import { TEAM_ACCOUNTS_FLAG_KEY } from '@shared/experiments/teamAccountsFlag'
import TeamPage from './components/TeamPage'

const meta = pageMetaData({
  title: 'Team',
  description: 'Manage who has access to your campaign on GoodParty.org.',
})
export const metadata = meta

export const dynamic = 'force-dynamic'

// Deliberately /dashboard/team, not /settings/team (the design's URL) — this
// app has no /settings segment; account settings already live at
// /dashboard/account, so this is the consistent sibling.
const Page = async (): Promise<React.JSX.Element> => {
  const { userId } = await auth()
  if (!userId) {
    redirect('/login')
  }

  return (
    <FeatureFlagGuard flagKey={TEAM_ACCOUNTS_FLAG_KEY}>
      <TeamPage />
    </FeatureFlagGuard>
  )
}

export default Page
