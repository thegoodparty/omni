import { fetchUserCampaign } from 'app/onboarding/shared/getCampaign'
import pageMetaData from 'helpers/metadataHelper'
import { serverRequest } from 'gpApi/server-request'
import { PageHeader } from '@styleguide'
import { SwordsIcon } from '@styleguide/components/ui/icons'
import candidateAccess from '../shared/candidateAccess'
import DashboardLayout from '../shared/DashboardLayout'
import FeatureFlagGuard from '@shared/experiments/FeatureFlagGuard'
import { KNOW_YOUR_OPPONENT_FLAG_KEY } from '@shared/experiments/knowYourOpponentFlag'
import RaceOpponentList from './components/RaceOpponentList'
import OpponentProLockedView from './components/OpponentProLockedView'
import type { RaceOpponentResponse } from 'gpApi/api-endpoints'

const EMPTY_RACE_OPPONENT: RaceOpponentResponse = {
  opponents: [],
  lastCollectedAt: null,
  collectionStatus: 'idle',
}

const racePlaceFor = (
  office: string | undefined,
  district: string | undefined,
): string | undefined => {
  const place = [office, district].filter(Boolean).join(', ')
  return place || undefined
}

const raceContextFor = (
  place: string | undefined,
  electionDate: string | undefined,
): string | undefined => {
  const parts: string[] = []
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
  // Non-Pro candidates land on an in-context upgrade pitch instead of being
  // redirected to /dashboard/pro-upgrade. The KNOW_YOUR_OPPONENT flag still
  // gates the ENTIRE surface, this locked view included: when the flag is off
  // the feature does not exist for the user, so FeatureFlagGuard intentionally
  // hides/bounces here too. Per ENG-10608 AC ("flag-off users see no nav item
  // and no page"). Do NOT render the locked view outside FeatureFlagGuard —
  // that would expose a gated, unreleased feature to every non-Pro user.
  if (!campaign?.isPro) {
    return (
      <DashboardLayout
        pathname="/dashboard/race-opponent"
        showAlert={false}
        wrapperClassName="!p-0"
      >
        {/* Desktop-only, like the DashboardNavHeader it replaced: on mobile the
            title lives in MobileMenuTrigger's top bar (MOBILE_PAGE_TITLES in
            DashboardLayout), so rendering this below lg would stack two title
            bars with duplicate h1s. */}
        <PageHeader
          className="max-lg:hidden"
          heading="Know Your Opponent"
          leading={
            <SwordsIcon className="size-5 text-foreground" aria-hidden />
          }
        />
        <FeatureFlagGuard flagKey={KNOW_YOUR_OPPONENT_FLAG_KEY}>
          <div className="bg-muted px-4 py-6 lg:px-8">
            <OpponentProLockedView />
          </div>
        </FeatureFlagGuard>
      </DashboardLayout>
    )
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

  // racePlace (office + district) feeds the field-header subtitle;
  // raceContext (place + election date) keeps feeding the PDF export header.
  const racePlace = racePlaceFor(
    campaign.details?.normalizedOffice ?? campaign.positionName ?? undefined,
    campaign.details?.district,
  )
  const raceContext = raceContextFor(racePlace, campaign.details?.electionDate)

  return (
    <DashboardLayout
      pathname="/dashboard/race-opponent"
      showAlert={false}
      wrapperClassName="!p-0"
    >
      {/* Desktop-only — see the non-Pro branch's note. */}
      <PageHeader
        className="max-lg:hidden"
        heading="Know Your Opponent"
        leading={<SwordsIcon className="size-5 text-foreground" aria-hidden />}
      />
      <FeatureFlagGuard flagKey={KNOW_YOUR_OPPONENT_FLAG_KEY}>
        <div className="bg-muted px-4 py-6 lg:px-8">
          <RaceOpponentList
            initialData={initialData}
            raceContext={raceContext}
            racePlace={racePlace}
          />
        </div>
      </FeatureFlagGuard>
    </DashboardLayout>
  )
}
