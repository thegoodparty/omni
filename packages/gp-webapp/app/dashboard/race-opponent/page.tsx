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
import { isRenderableContrast } from './components/ContrastCard'
import RegenerateContrasts from './components/RegenerateContrasts'
import type { ContrastRecord, RaceOpponentResponse } from 'gpApi/api-endpoints'

const EMPTY_RACE_OPPONENT: RaceOpponentResponse = {
  opponents: [],
  lastCollectedAt: null,
  collectionStatus: 'idle',
}

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

  // serverRequest only returns { ok: false } on non-2xx with
  // ignoreResponseError; without it ofetch.raw throws a FetchError on any
  // non-2xx and the RSC render 500s instead of showing the empty state. On a
  // non-ok response `data` is the error body, not a RaceOpponentResponse, so
  // fall back to an empty shape rather than reading .opponents off it.
  const raceOpponentResult = await serverRequest(
    'GET /v1/campaigns/mine/race-opponent',
    {},
    { ignoreResponseError: true },
  )
  const initialData: RaceOpponentResponse = raceOpponentResult.ok
    ? raceOpponentResult.data
    : EMPTY_RACE_OPPONENT

  // Contrasts are gated server-side on a completed self-research pass: the
  // endpoint 403s until then (the path for every new user). serverRequest only
  // returns { ok: false } on non-2xx with ignoreResponseError; without it
  // ofetch.raw throws a FetchError before .ok is read, so the [] fallback never
  // runs and the render 500s. Guard on .ok — accessing .contrasts on the error
  // body would be undefined and crash ContrastList's filter.
  const contrastResult = await serverRequest(
    'GET /v1/campaigns/mine/race-opponent/contrasts',
    {},
    { ignoreResponseError: true },
  )
  // Filter to renderable contrasts here so the section gate below matches what
  // ContrastList will actually show. Otherwise non-renderable contrasts (e.g.
  // missing sourceUrl) would mount the "Review your contrasts" shell while
  // ContrastList renders null inside it.
  const contrasts: ContrastRecord[] = contrastResult.ok
    ? contrastResult.data.contrasts.filter(isRenderableContrast)
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
      navHeader={{ icon: 'swords', label: 'Know your opponent' }}
    >
      <FeatureFlagGuard flagKey={KNOW_YOUR_OPPONENT_FLAG_KEY}>
        <RaceOpponentList initialData={initialData} raceContext={raceContext} />
        {/* Contrasts are a Phase-1 surface: hidden, not placeholdered. The whole
            section (heading, blurb, Refresh control) stays out of the DOM until
            real contrasts exist, so no empty "Review your contrasts" shell shows
            for the pre-Phase-1 user whose contrasts endpoint 403s. */}
        {contrasts.length > 0 && (
          <section className="mx-auto flex w-full max-w-[720px] flex-col gap-4 px-6 pb-28">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div className="flex flex-col gap-0.5">
                <h2 className="text-xl font-semibold text-foreground">
                  Review your contrasts
                </h2>
                <p className="text-sm text-muted-foreground">
                  Each contrast pairs a sourced opponent fact with your
                  position. Edit the wording, then route it to your Campaign
                  Story or Texting as a draft. Nothing sends automatically.
                </p>
              </div>
              <RegenerateContrasts />
            </div>
            <ContrastList initialContrasts={contrasts} />
          </section>
        )}
      </FeatureFlagGuard>
    </DashboardLayout>
  )
}
