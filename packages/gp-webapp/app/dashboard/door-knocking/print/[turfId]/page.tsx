import { notFound } from 'next/navigation'
import { FetchError } from 'ofetch'
import { DoorKnockingRoutePayload } from '@goodparty_org/contracts'
import pageMetaData from 'helpers/metadataHelper'
import { serverRequest } from 'gpApi/server-request'
import candidateAccess from 'app/dashboard/shared/candidateAccess'
import WalkSheet from '../WalkSheet'

export const metadata = pageMetaData({
  title: 'Walk list | GoodParty.org',
  description: 'Printable door-knocking walk list',
  slug: '/dashboard/door-knocking/print',
})

export const dynamic = 'force-dynamic'

const fetchRoute = async (
  turfId: string,
): Promise<DoorKnockingRoutePayload | null> => {
  try {
    const response = await serverRequest(
      'GET /v1/door-knocking/turfs/:id/route',
      {
        id: turfId,
      },
    )
    return response.data
  } catch (error) {
    // gp-api 404s every "nothing to show" case — a turf that isn't yours,
    // doesn't exist, or was never knocked — and the sheet has nothing useful
    // to say about any of them. Anything else (a 500, a timeout) is a
    // different problem, and swallowing it would hand someone chasing signal
    // a "not found" page for a route that exists, with no hint to retry.
    if (error instanceof FetchError && error.status === 404) return null
    throw error
  }
}

// The name is decoration; the route is the sheet. If this read fails the
// walk list is still complete and worth printing, so it degrades to a
// generic title rather than taking the page down with it.
const fetchTurfName = async (turfId: string): Promise<string> => {
  try {
    const response = await serverRequest('GET /v1/door-knocking/turfs', {})
    const turf = response.data.find((entry) => String(entry.id) === turfId)
    return turf?.name ?? 'Walk list'
  } catch {
    return 'Walk list'
  }
}

// Deliberately outside the dashboard chrome: this page exists to become paper,
// and a printed nav rail is wasted ink. It renders on the server with no
// client component of its own, so it prints identically with JavaScript
// disabled and needs no hydration on a phone with one bar of signal.
export default async function Page({
  params,
}: {
  params: Promise<{ turfId: string }>
}): Promise<React.JSX.Element> {
  await candidateAccess()

  const { turfId } = await params
  const [payload, turfName] = await Promise.all([
    fetchRoute(turfId),
    fetchTurfName(turfId),
  ])
  if (!payload) notFound()

  return <WalkSheet turfName={turfName} payload={payload} />
}
