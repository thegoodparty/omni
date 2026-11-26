import pageMetaData from 'helpers/metadataHelper'
import type { SearchParams } from 'next/dist/server/request/search-params'
import { redirect } from 'next/navigation'
import { apiRoutes } from 'gpApi/routes'
import { serverFetch } from 'gpApi/serverFetch'
import candidateAccess from '../shared/candidateAccess'
import { ALL_PLANS_HIGHLIGHT_PARAM } from '../shared/plan/planPitch'
import {
  PLANS_BACK_TO_PARAM,
  parsePlansBackTo,
} from '../pro-upgrade/proUpgradePlanParams'
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
  const electedOfficeResp = await serverFetch(apiRoutes.electedOffice.current)
  if (electedOfficeResp?.ok && electedOfficeResp?.data) {
    return redirect('/dashboard/chief-of-staff')
  }
  const params = await searchParams

  const backTo = params[PLANS_BACK_TO_PARAM]

  return (
    <PlansPage
      highlightTeam={params[ALL_PLANS_HIGHLIGHT_PARAM] === 'team'}
      backTo={parsePlansBackTo(typeof backTo === 'string' ? backTo : null)}
    />
  )
}
