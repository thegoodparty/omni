import pageMetaData from 'helpers/metadataHelper'
import candidateAccess from '../shared/candidateAccess'
import { fetchUserCampaign } from 'app/onboarding/shared/getCampaign'
import DoorKnockingPageGate from './native/DoorKnockingPageGate'
import { parsePositiveListId } from 'app/dashboard/outreach/util/parsePositiveListId.util'
import { parseRecommendedListVariant } from 'app/dashboard/outreach/util/parseRecommendedListVariant.util'
import { serverFetch } from 'gpApi/serverFetch'
import { apiRoutes } from 'gpApi/routes'

interface EcanvasserSummary {
  totalInteractions?: number
  totalContactAttempts?: number
  totalHouseholds?: number
  lastSync?: string
}

// Both reads below are wrapped, and the reason is that they share a
// `Promise.all`: an unguarded `fetch` rejection (DNS, ECONNREFUSED, timeout)
// propagates out of either one and crashes the whole server render, which
// would take the page down instead of degrading it. Undefined is the
// "unknown" both callers already handle.
async function fetchEcanvasserSummary(): Promise<
  EcanvasserSummary | undefined
> {
  try {
    const response = await serverFetch<EcanvasserSummary>(
      apiRoutes.ecanvasser.mySummary,
    )
    return response.data
  } catch {
    return undefined
  }
}

// Whether candidate success has connected this campaign to eCanvasser, which
// is the flag-off arm's own entitlement and the only thing that can put
// numbers on its dashboard. `GET /ecanvasser/mine` answers it three ways: a
// connected campaign gets its record, an unconnected one gets 200 with a null
// body (the service's `findFirst`), and a Serve org gets a 404 from the
// campaign guard because it has no campaign to look one up for.
//
// **`response.ok` is load-bearing, not belt-and-braces.** `clientFetch` puts
// the parsed body on `.data` whatever the status, and Nest's 404 body is
// `{"statusCode":404,"message":"Not Found"}` — a truthy object. Reading
// `.data` alone therefore reports every Serve org as CONNECTED, which the
// client-side Serve bounce would usually mask and would stop masking on any
// cold load where the org slug has not hydrated yet.
//
// Read server-side beside the summary rather than through
// `EcanvasserProvider`, which the gate mounts BELOW itself inside
// `DashboardLayout` and so cannot read.
async function fetchHasEcanvasser(): Promise<boolean | undefined> {
  try {
    const response = await serverFetch(apiRoutes.ecanvasser.mine)
    return response.ok && Boolean(response.data)
  } catch {
    return undefined
  }
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
    recommended?: string
    walkTurfId?: string
    outreachId?: string
    create?: string
    campaignOutreachId?: string
  }>
}

export default async function Page({
  searchParams,
}: PageParams): Promise<React.JSX.Element> {
  await candidateAccess()

  const [
    { listId, recommended, walkTurfId, outreachId, create, campaignOutreachId },
    campaign,
    summary,
    hasEcanvasser,
  ] = await Promise.all([
    searchParams,
    fetchUserCampaign(),
    fetchEcanvasserSummary(),
    fetchHasEcanvasser(),
  ])

  // Carries a saved list from the outreach hub's door-knocking tile so the
  // create flow's who step opens on it. The same parser the outreach page
  // uses, so the "ignore anything that isn't a positive integer" rule cannot
  // drift between the two landing pages: a missing or malformed id leaves the
  // page exactly as it was before the param existed, and an id that no longer
  // resolves to one of this org's lists is dropped downstream by the picker.
  const preselectedListId = parsePositiveListId(listId)
  // The hub tile's other carry: a voter data page recommendation not saved
  // yet. Same stance — an unknown variant is dropped, never an error.
  const preselectedRecommendedVariant = parseRecommendedListVariant(recommended)

  const childProps = {
    pathname: '/dashboard/door-knocking',
    campaign,
    summary,
    hasEcanvasser,
    preselectedListId,
    preselectedRecommendedVariant,
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
    // "Add another turf" from the campaign drawer — the id of the anchor
    // Outreach the new turf should join. Same positive-integer rule as the
    // list/turf ids above; the drawer never sends anything else, and a
    // malformed value is dropped rather than opening a broken flow.
    campaignOutreachId: parsePositiveListId(campaignOutreachId),
  }

  return <DoorKnockingPageGate {...childProps} />
}
