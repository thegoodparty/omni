import pageMetaData from 'helpers/metadataHelper'
import serveAccess from '../shared/serveAccess'
import ConstituentOutreachPage from './ConstituentOutreachPage'
import { serverFetch } from 'gpApi/serverFetch'
import { apiRoutes } from 'gpApi/routes'
import type { Outreach } from 'app/dashboard/outreach/hooks/OutreachContext'

// Mirrors app/dashboard/outreach/page.tsx's fetchOutreaches: a Serve org has
// no campaign, so GET /v1/outreach 404s (UseCampaignGuard) rather than
// erroring — that's an empty history, not a failure.
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
  title: 'Constituent Outreach | GoodParty.org',
  description: 'Constituent outreach',
  slug: '/dashboard/constituent-outreach',
})

export const metadata = meta
export const dynamic = 'force-dynamic'

export default async function Page(): Promise<React.JSX.Element> {
  await serveAccess()
  const outreaches = await fetchOutreaches()
  return (
    <ConstituentOutreachPage
      pathname="/dashboard/constituent-outreach"
      outreaches={outreaches}
    />
  )
}
