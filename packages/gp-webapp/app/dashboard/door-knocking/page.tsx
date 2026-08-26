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
  searchParams: Promise<{ listId?: string }>
}

export default async function Page({
  searchParams,
}: PageParams): Promise<React.JSX.Element> {
  await candidateAccess()

  const [{ listId }, campaign, summary] = await Promise.all([
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
  }

  return <DoorKnockingPageGate {...childProps} />
}
