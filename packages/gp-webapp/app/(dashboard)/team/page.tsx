import pageMetaData from 'helpers/metadataHelper'
import candidateAccess from '../shared/candidateAccess'
import TeamPage from './components/TeamPage'

const meta = pageMetaData({
  title: 'Team',
  description: 'Manage who has access to your campaign on GoodParty.org.',
})
export const metadata = meta

export const dynamic = 'force-dynamic'

// Deliberately /team, not /settings/team (the design's URL) — this
// app has no /settings segment; account settings already live at
// /account, so this is the consistent sibling.
const Page = async (): Promise<React.JSX.Element> => {
  await candidateAccess()

  return <TeamPage />
}

export default Page
