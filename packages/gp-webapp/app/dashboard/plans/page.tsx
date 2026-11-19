import pageMetaData from 'helpers/metadataHelper'
import type { SearchParams } from 'next/dist/server/request/search-params'
import candidateAccess from '../shared/candidateAccess'
import { ALL_PLANS_HIGHLIGHT_PARAM } from '../shared/plan/planPitch'
import PlansPage from './PlansPage'

export const metadata = pageMetaData({
  title: 'Plans | GoodParty.org',
  description: 'Compare GoodParty.org plans',
  slug: '/dashboard/plans',
})

export const dynamic = 'force-dynamic'

interface PageProps {
  searchParams: Promise<SearchParams>
}

export default async function Page({
  searchParams,
}: PageProps): Promise<React.JSX.Element> {
  await candidateAccess()
  const params = await searchParams

  return (
    <PlansPage highlightTeam={params[ALL_PLANS_HIGHLIGHT_PARAM] === 'team'} />
  )
}
