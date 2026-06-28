import { fetchUserCampaign } from 'app/onboarding/shared/getCampaign'
import pageMetaData from 'helpers/metadataHelper'
import { redirect } from 'next/navigation'
import { serverRequest } from 'gpApi/server-request'
import candidateAccess from '../shared/candidateAccess'
import DashboardLayout from '../shared/DashboardLayout'
import FeatureFlagGuard from '@shared/experiments/FeatureFlagGuard'
import { KNOW_YOUR_OPPONENT_FLAG_KEY } from '@shared/experiments/knowYourOpponentFlag'
import RaceOpponentList from './components/RaceOpponentList'
import OpponentPageHeader from './components/OpponentPageHeader'
import OpponentOverviewCard from './components/OpponentOverviewCard'
import ContrastList from './components/ContrastList'
import RegenerateContrasts from './components/RegenerateContrasts'
import type { ContrastRecord } from 'gpApi/api-endpoints'

const initialsFor = (name: string): string =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('') || '?'

const raceContextFor = (
  office: string | undefined,
  district: string | undefined,
  electionDate: string | undefined,
): string | undefined => {
  const parts: string[] = []
  const place = [office, district].filter(Boolean).join(', ')
  if (place) {
    parts.push(place)
  }
  if (electionDate) {
    const date = new Date(electionDate)
    if (!Number.isNaN(date.getTime())) {
      parts.push(
        `Election ${date.toLocaleDateString('en-US', {
          month: 'long',
          day: 'numeric',
          year: 'numeric',
          timeZone: 'UTC',
        })}`,
      )
    }
  }
  return parts.length > 0 ? parts.join(' · ') : undefined
}

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
  // endpoint 403s until then. serverRequest returns { ok: false } on non-2xx
  // (it does not throw), so guard on .ok — accessing .contrasts on the error
  // body would be undefined and crash ContrastList's filter.
  const contrastResult = await serverRequest(
    'GET /v1/campaigns/mine/race-opponent/contrasts',
    {},
  )
  const contrasts: ContrastRecord[] = contrastResult.ok
    ? contrastResult.data.contrasts
    : []

  const raceContext = raceContextFor(
    campaign.details?.normalizedOffice ?? undefined,
    campaign.details?.district,
    campaign.details?.electionDate,
  )

  return (
    <DashboardLayout
      pathname="/dashboard/race-opponent"
      showAlert={false}
      wrapperClassName="!p-0"
    >
      <FeatureFlagGuard flagKey={KNOW_YOUR_OPPONENT_FLAG_KEY}>
        <section className="mx-auto flex w-full max-w-[1120px] flex-col gap-6 px-6 pt-6">
          <OpponentPageHeader
            title="Know your opponent"
            raceContext={raceContext}
          />
          {data.opponents.length > 0 && (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {data.opponents.map((opponent) => (
                <OpponentOverviewCard
                  key={opponent.opponentName}
                  name={opponent.opponentName}
                  initials={initialsFor(opponent.opponentName)}
                  party={opponent.party}
                  isIncumbent={opponent.isIncumbent}
                  summary={opponent.summary?.overview?.text}
                />
              ))}
            </div>
          )}
        </section>
        <RaceOpponentList initialData={data} />
        <section className="mx-auto flex w-full max-w-[720px] flex-col gap-4 px-6 pb-28">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="flex flex-col gap-0.5">
              <h2 className="text-xl font-semibold text-foreground">
                Review your contrasts
              </h2>
              <p className="text-sm text-muted-foreground">
                Each contrast pairs a sourced opponent fact with your position.
                Edit the wording, then route it to your Campaign Story or
                Texting as a draft. Nothing sends automatically.
              </p>
            </div>
            <RegenerateContrasts />
          </div>
          <ContrastList initialContrasts={contrasts} />
        </section>
      </FeatureFlagGuard>
    </DashboardLayout>
  )
}
