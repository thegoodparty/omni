import pageMetaData from 'helpers/metadataHelper'
import { OutreachPage } from './components/OutreachPage'
import candidateAccess from '../shared/candidateAccess'
import { fetchUserCampaign } from 'app/onboarding/shared/getCampaign'
import { NUM_OF_MOCK_OUTREACHES } from 'app/dashboard/outreach/constants'
import { createOutreach } from 'app/dashboard/outreach/util/createOutreach.util'
import { parsePositiveListId } from 'app/dashboard/outreach/util/parsePositiveListId.util'
import { serverFetch } from 'gpApi/serverFetch'
import { apiRoutes } from 'gpApi/routes'
import { redirect } from 'next/navigation'
import { getMarketingUrl } from 'helpers/linkhelper'
import { Outreach } from './hooks/OutreachContext'
import { TcrCompliance } from 'helpers/types'

const fetchOutreaches = async (): Promise<Outreach[]> => {
  const response = await serverFetch<Outreach[]>(apiRoutes.outreach.list)
  if (!response.ok) {
    if (response.status === 404) {
      return []
    }
    throw new Error('Failed to fetch outreach data')
  }
  return response.data || []
}

const meta = pageMetaData({
  title: 'Outreach | GoodParty.org',
  description: 'Manage your campaign outreach activities.',
  slug: '/dashboard/outreach',
})
export const metadata = meta
export const dynamic = 'force-dynamic'

interface PageParams {
  searchParams: Promise<{ listId?: string; outreachId?: string }>
}

export default async function Page({
  searchParams,
}: PageParams): Promise<React.JSX.Element> {
  await candidateAccess()
  const campaign = await fetchUserCampaign()

  if (!campaign) {
    redirect(getMarketingUrl('/run-for-office'))
  }

  const { listId, outreachId } = await searchParams
  // ENG-10762: carries the saved list's id from a CRM "Send outreach" link.
  // Anything that isn't a positive integer (missing, malformed) is ignored
  // so the page behaves exactly as it did before the listId param existed.
  const preselectedListId = parsePositiveListId(listId)
  // ENG-10769: carries a campaign's id from the activity feed's "View
  // outreach" link so the table can scroll to and highlight its row. Same
  // positive-integer rule (the parser is id-agnostic despite its name).
  const highlightOutreachId = parsePositiveListId(outreachId)

  const [outreaches, tcrComplianceResponse] = await Promise.all([
    fetchOutreaches(),
    serverFetch<TcrCompliance>(apiRoutes.campaign.tcrCompliance.fetch),
  ])

  const tcrCompliance: TcrCompliance | undefined = tcrComplianceResponse.ok
    ? tcrComplianceResponse.data
    : undefined

  const mockOutreaches = Array.from({ length: NUM_OF_MOCK_OUTREACHES }, () =>
    createOutreach(campaign.id),
  )

  return (
    <OutreachPage
      {...{
        pathname: '/dashboard/outreach',
        campaign,
        outreaches,
        mockOutreaches,
        tcrCompliance,
        preselectedListId,
        highlightOutreachId,
      }}
    />
  )
}
