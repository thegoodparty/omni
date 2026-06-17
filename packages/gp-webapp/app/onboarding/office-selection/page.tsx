export const dynamic = 'force-dynamic'

import pageMetaData from 'helpers/metadataHelper'
import OnboardingFlow from '../components/OnboardingFlow'
import FollowOnFlow from '../components/FollowOnFlow'
import { fetchUserCampaign } from '../shared/getCampaign'

const meta = pageMetaData({
  title: 'Candidate Onboarding | GoodParty.org',
  description: 'Candidate Onboarding.',
  slug: '/onboarding',
})
export const metadata = meta

export default async function Page({
  searchParams,
}: PageProps<'/onboarding/office-selection'>): Promise<React.JSX.Element> {
  const { intent, from } = await searchParams

  // The org switcher's "run for" actions enter this route with an intent
  // query param, opening the follow-on flow (create a new campaign org).
  // Without it, this is the standard first-time onboarding flow.
  if (intent === 'same-office' || intent === 'new-office') {
    return (
      <FollowOnFlow
        intent={intent}
        fromOrganizationSlug={typeof from === 'string' ? from : undefined}
      />
    )
  }

  const campaign = await fetchUserCampaign()
  return <OnboardingFlow campaign={campaign} />
}
