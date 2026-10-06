import pageMetaData from 'helpers/metadataHelper'
import { fetchUserCampaign } from 'app/onboarding/shared/getCampaign'
import candidateAccess from '../shared/candidateAccess'
import OfficeDetailsCard from '../campaign-details/components/cards/OfficeDetailsCard'
import { FocusedPage } from '../shared/FocusedPage'

const meta = pageMetaData({
  title: 'Your race | GoodParty.org',
  description: 'The office you are running for and when the election is.',
  slug: '/race',
})

export const metadata = meta
export const dynamic = 'force-dynamic'

// "Your race", opened from the Game Plan's card: the office the candidate is
// running for, where, and when the election is, with Change office to fix
// any of it. The same card Profile shows, on a page of its own.
export default async function Page(): Promise<React.JSX.Element> {
  await candidateAccess()
  const campaign = await fetchUserCampaign()
  return (
    <FocusedPage title="Your race">
      <OfficeDetailsCard campaign={campaign ?? undefined} />
    </FocusedPage>
  )
}
