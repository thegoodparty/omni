import { fetchUserCampaign } from 'app/onboarding/shared/getCampaign'
import pageMetaData from 'helpers/metadataHelper'
import { redirect } from 'next/navigation'
import { serverRequest } from 'gpApi/server-request'
import { FetchError } from 'ofetch'
import candidateAccess from '../../shared/candidateAccess'
import DashboardLayout from '../../shared/DashboardLayout'
import FeatureFlagGuard from '@shared/experiments/FeatureFlagGuard'
import { KNOW_YOUR_OPPONENT_FLAG_KEY } from '@shared/experiments/knowYourOpponentFlag'
import OpponentResearch from '../components/OpponentResearch'
import OpponentProLockedView from '../components/OpponentProLockedView'
import type {
  IdentifyOpponentsResponse,
  RaceOpponentActivityResponse,
} from 'gpApi/api-endpoints'

const meta = pageMetaData({
  title: 'Know your opponent | GoodParty.org',
  description: 'A sourced profile of your opponent and what changes over time',
  slug: '/dashboard/race-opponent/opponents',
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
        pathname="/dashboard/race-opponent/opponents"
        showAlert={false}
        wrapperClassName="!p-0"
      >
        <FeatureFlagGuard flagKey={KNOW_YOUR_OPPONENT_FLAG_KEY}>
          <OpponentProLockedView />
        </FeatureFlagGuard>
      </DashboardLayout>
    )
  }

  // Opponent research is hard-gated server-side on a completed self-research
  // pass: the identify/research/profile routes 403 until then. Route the
  // candidate to self-research first rather than surfacing a forbidden error.
  const { data: selfResearch } = await serverRequest(
    'GET /v1/campaigns/mine/race-opponent/self-research/status',
    {},
  )
  if (selfResearch.status !== 'completed') {
    redirect('/dashboard/race-opponent/self-research')
  }

  // identify defaults the opponent set from the election-api roster so the
  // candidate confirms a real match. Both calls are behind the same gate we
  // just cleared; a transient 403 still degrades to the empty/no-activity case.
  let opponentNames: IdentifyOpponentsResponse['opponentNames'] = []
  let initialActivity: RaceOpponentActivityResponse | null = null
  try {
    const [identify, activity] = await Promise.all([
      serverRequest(
        'POST /v1/campaigns/mine/race-opponent/opponents/identify',
        {},
      ),
      serverRequest(
        'GET /v1/campaigns/mine/race-opponent/opponents/activity',
        {},
      ),
    ])
    opponentNames = identify.data.opponentNames
    initialActivity = activity.data
  } catch (error) {
    if (error instanceof FetchError && error.status === 403) {
      redirect('/dashboard/race-opponent/self-research')
    }
    throw error
  }

  return (
    <DashboardLayout
      pathname="/dashboard/race-opponent/opponents"
      showAlert={false}
      wrapperClassName="!p-0"
    >
      <FeatureFlagGuard flagKey={KNOW_YOUR_OPPONENT_FLAG_KEY}>
        <OpponentResearch
          opponentNames={opponentNames}
          initialProfile={null}
          initialActivity={initialActivity}
        />
      </FeatureFlagGuard>
    </DashboardLayout>
  )
}
