import pageMetaData from 'helpers/metadataHelper'
import candidateAccess from '../shared/candidateAccess'
import { fetchUserCampaign } from 'app/onboarding/shared/getCampaign'
import DoorKnockingPageGate from './native/DoorKnockingPageGate'
import { parsePositiveListId } from 'app/dashboard/outreach/util/parsePositiveListId.util'
import { serverFetch } from 'gpApi/serverFetch'
import { apiRoutes } from 'gpApi/routes'

interface EcanvasserSummary {
  totalInteractions?: number
  totalContactAttempts?: number
  totalHouseholds?: number
  lastSync?: string
}

async function fetchEcanvasserSummary(): Promise<
  EcanvasserSummary | undefined
> {
  const response = await serverFetch<EcanvasserSummary>(
    apiRoutes.ecanvasser.mySummary,
  )
  return response.data
}

const meta = pageMetaData({
  title: 'Door Knocking | GoodParty.org',
  description: 'Door Knocking',
  slug: '/dashboard/door-knocking',
})
export const metadata = meta

export const dynamic = 'force-dynamic'

interface PageParams {
  searchParams: Promise<{
    listId?: string
    walkTurfId?: string
    outreachId?: string
    create?: string
  }>
}

export default async function Page({
  searchParams,
}: PageParams): Promise<React.JSX.Element> {
  await candidateAccess()

  const [{ listId, walkTurfId, outreachId, create }, campaign, summary] =
    await Promise.all([
      searchParams,
      fetchUserCampaign(),
      fetchEcanvasserSummary(),
    ])

  // Carries a saved list from the outreach hub's door-knocking tile so the
  // create flow's who step opens on it. The same parser the outreach page
  // uses, so the "ignore anything that isn't a positive integer" rule cannot
  // drift between the two landing pages: a missing or malformed id leaves the
  // page exactly as it was before the param existed, and an id that no longer
  // resolves to one of this org's lists is dropped downstream by the picker.
  const preselectedListId = parsePositiveListId(listId)

  const childProps = {
    pathname: '/dashboard/door-knocking',
    campaign,
    summary,
    preselectedListId,
    // "Continue knocking" on an outreach row. A turf rather than a list, and
    // it opens that turf's walk rather than the create flow — the two params
    // name different nouns and do different things, which is why they are two.
    // Same positive-integer rule as `listId`, and for the same reason: an id
    // that names nothing is dropped downstream rather than handled here.
    walkTurfId: parsePositiveListId(walkTurfId),
    // Which row sent us, so closing that walk reopens its drawer.
    fromOutreachId: parsePositiveListId(outreachId),
    // The outreach hub's door-knocking tile asks to start a walk, so it
    // arrives with the create flow already open rather than on the rail.
    // Exactly `'1'` — anything else is somebody's stray query string, and the
    // page it would open a modal over is perfectly usable without one.
    openCreateFlow: create === '1',
  }

  return <DoorKnockingPageGate {...childProps} />
}
