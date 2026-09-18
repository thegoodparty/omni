import pageMetaData from 'helpers/metadataHelper'
import candidateAccess from 'app/dashboard/shared/candidateAccess'
import FeatureFlagGuard from 'app/shared/experiments/FeatureFlagGuard'
import { OUTREACH_PRO_GATING_V2_FLAG_KEY } from 'app/shared/experiments/outreachProGatingV2Flag'
import CampaignVerificationFlow from './components/CampaignVerificationFlow'

const meta = pageMetaData({
  title: 'Campaign verification | GoodParty.org',
  description: 'Verify your campaign to send text messages.',
  slug: '/dashboard/campaign-verification',
})
export const metadata = meta

export const dynamic = 'force-dynamic'

export default async function Page(): Promise<React.JSX.Element> {
  await candidateAccess()

  return (
    <FeatureFlagGuard flagKey={OUTREACH_PRO_GATING_V2_FLAG_KEY}>
      <CampaignVerificationFlow />
    </FeatureFlagGuard>
  )
}
