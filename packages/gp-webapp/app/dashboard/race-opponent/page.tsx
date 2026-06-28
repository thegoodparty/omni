import { fetchUserCampaign } from 'app/onboarding/shared/getCampaign'
import pageMetaData from 'helpers/metadataHelper'
import { redirect } from 'next/navigation'
import { serverRequest } from 'gpApi/server-request'
import candidateAccess from '../shared/candidateAccess'
import DashboardLayout from '../shared/DashboardLayout'
import FeatureFlagGuard from '@shared/experiments/FeatureFlagGuard'
import { KNOW_YOUR_OPPONENT_FLAG_KEY } from '@shared/experiments/knowYourOpponentFlag'
import RaceOpponentList from './components/RaceOpponentList'
import ContrastList from './components/ContrastList'
import type { ContrastRecord } from 'gpApi/api-endpoints'

const meta = pageMetaData({
  title: 'Know your opponent | GoodParty.org',
  description: 'Collected research on your opponents',
  slug: '/dashboard/race-opponent',
})
export const metadata = meta
export const dynamic = 'force-dynamic'

export default async function Page(): Promise<React.JSX.Element> {
  await candidateAccess()

  const campaign = await fetchUserCampaign()
  if (!campaign?.isPro) {
    redirect('/dashboard/pro-upgrade')
  }

  const { data } = await serverRequest(
    'GET /v1/campaigns/mine/race-opponent',
    {},
  )

  // Contrasts are gated server-side on a completed self-research pass: the
  // endpoint 403s until then. That's an expected state, not an error, so a
  // failed fetch falls back to an empty list rather than crashing the page.
  let contrasts: ContrastRecord[] = []
  try {
    const { data: contrastData } = await serverRequest(
      'GET /v1/campaigns/mine/race-opponent/contrasts',
      {},
    )
    contrasts = contrastData.contrasts
  } catch {
    contrasts = []
  }

  return (
    <DashboardLayout
      pathname="/dashboard/race-opponent"
      showAlert={false}
      wrapperClassName="!p-0"
    >
      <FeatureFlagGuard flagKey={KNOW_YOUR_OPPONENT_FLAG_KEY}>
        <RaceOpponentList initialData={data} />
        <section className="mx-auto flex w-full max-w-[720px] flex-col gap-4 px-6 pb-28">
          <div className="flex flex-col gap-0.5">
            <h2 className="text-xl font-semibold text-foreground">
              Review your contrasts
            </h2>
            <p className="text-sm text-muted-foreground">
              Each contrast pairs a sourced opponent fact with your position.
              Edit the wording, then route it to your Campaign Story or Texting
              as a draft. Nothing sends automatically.
            </p>
          </div>
          <ContrastList initialContrasts={contrasts} />
        </section>
      </FeatureFlagGuard>
    </DashboardLayout>
  )
}
