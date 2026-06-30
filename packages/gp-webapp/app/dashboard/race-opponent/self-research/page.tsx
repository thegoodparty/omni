import { fetchUserCampaign } from 'app/onboarding/shared/getCampaign'
import pageMetaData from 'helpers/metadataHelper'
import { serverRequest } from 'gpApi/server-request'
import candidateAccess from '../../shared/candidateAccess'
import DashboardLayout from '../../shared/DashboardLayout'
import FeatureFlagGuard from '@shared/experiments/FeatureFlagGuard'
import { KNOW_YOUR_OPPONENT_FLAG_KEY } from '@shared/experiments/knowYourOpponentFlag'
import SelfResearch from '../components/SelfResearch'
import OpponentProLockedView from '../components/OpponentProLockedView'

const meta = pageMetaData({
  title: 'Research yourself | GoodParty.org',
  description: 'A private report of what opponents can find on you',
  slug: '/dashboard/race-opponent/self-research',
})
export const metadata = meta
export const dynamic = 'force-dynamic'

export default async function Page(): Promise<React.JSX.Element> {
  await candidateAccess()

  const campaign = await fetchUserCampaign()
  // Non-Pro candidates see the locked upgrade view in place of the research
  // surface, so a non-Pro deep-link to this subroute shows the pitch rather
  // than the pro-upgrade redirect. The KNOW_YOUR_OPPONENT flag still gates the
  // ENTIRE surface, this locked view included: when the flag is off the feature
  // does not exist for the user, so FeatureFlagGuard intentionally hides/bounces
  // here too. Per ENG-10608 AC ("flag-off users see no nav item and no page").
  // Do NOT render the locked view outside FeatureFlagGuard.
  if (!campaign?.isPro) {
    return (
      <DashboardLayout
        pathname="/dashboard/race-opponent/self-research"
        showAlert={false}
        wrapperClassName="!p-0"
      >
        <FeatureFlagGuard flagKey={KNOW_YOUR_OPPONENT_FLAG_KEY}>
          <OpponentProLockedView />
        </FeatureFlagGuard>
      </DashboardLayout>
    )
  }

  const { data } = await serverRequest(
    'GET /v1/campaigns/mine/race-opponent/self-research/status',
    {},
  )

  const fullName = [campaign.firstName, campaign.lastName]
    .filter((part): part is string => Boolean(part))
    .join(' ')

  return (
    <DashboardLayout
      pathname="/dashboard/race-opponent/self-research"
      showAlert={false}
      wrapperClassName="!p-0"
    >
      <FeatureFlagGuard flagKey={KNOW_YOUR_OPPONENT_FLAG_KEY}>
        <SelfResearch
          initialStatus={data}
          intakeDefaults={{
            fullName,
            office: campaign.details?.normalizedOffice ?? '',
            district: campaign.details?.district ?? '',
          }}
        />
      </FeatureFlagGuard>
    </DashboardLayout>
  )
}
