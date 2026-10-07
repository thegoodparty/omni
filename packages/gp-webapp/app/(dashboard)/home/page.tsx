import pageMetaData from 'helpers/metadataHelper'
import DashboardContent from '../components/DashboardContent'
import candidateAccess from '../shared/candidateAccess'
import { apiRoutes } from 'gpApi/routes'
import { serverFetch } from 'gpApi/serverFetch'
import { fetchUserWebsite } from 'helpers/fetchUserWebsite'
import { isWebsiteSunsetEligible } from '../shared/websiteSunset'
import { redirect } from 'next/navigation'

const meta = pageMetaData({
  title: 'Home | GoodParty.org',
  description: 'Home',
  slug: '/home',
})
export const metadata = meta
export const dynamic = 'force-dynamic'

export default async function Page(): Promise<React.JSX.Element> {
  // `candidateAccess` gates the page (auth → orgs → campaign status) and the
  // elected-office lookup is an independent, cheap, idempotent GET, so start it
  // alongside the gate to overlap the round trips. `allSettled` keeps the gate
  // authoritative: if `candidateAccess` redirects or throws we surface that
  // first and discard the (wasted) elected-office result, so no redirect is
  // reordered or swallowed on the redirect paths.
  const [accessResult, electedOfficeResult] = await Promise.allSettled([
    candidateAccess(),
    serverFetch(apiRoutes.electedOffice.current),
  ])
  if (accessResult.status === 'rejected') {
    throw accessResult.reason
  }
  if (electedOfficeResult.status === 'rejected') {
    throw electedOfficeResult.reason
  }
  const electedOfficeResp = electedOfficeResult.value
  if (electedOfficeResp?.ok && electedOfficeResp?.data) {
    return redirect('/chief-of-staff')
  }

  const website = await fetchUserWebsite()

  return (
    <DashboardContent
      pathname="/home"
      sunsetEligible={isWebsiteSunsetEligible(website)}
    />
  )
}
