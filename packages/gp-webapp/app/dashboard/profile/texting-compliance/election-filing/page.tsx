import pageMetaData from 'helpers/metadataHelper'
import ElectionFiling from './components/ElectionFiling'
import candidateAccess from 'app/dashboard/shared/candidateAccess'
import { fetchUserCampaign } from 'app/onboarding/shared/getCampaign'
import SmsCutoffPage from 'app/dashboard/campaign-verification/components/SmsCutoffPage'

const meta = pageMetaData({
  title: 'Election Filing | GoodParty.org',
  description: 'Election filing settings for GoodParty.org.',
})
export const metadata = meta

export default async function Page(): Promise<React.JSX.Element> {
  await candidateAccess()
  const campaign = await fetchUserCampaign()

  if (campaign?.smsCompliance === 'closed') {
    return <SmsCutoffPage surface="legacy_election_filing" />
  }

  return <ElectionFiling />
}
