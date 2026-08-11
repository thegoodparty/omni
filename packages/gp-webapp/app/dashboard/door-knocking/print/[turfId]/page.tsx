import { notFound } from 'next/navigation'
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
  } catch {
    // A turf that isn't yours, doesn't exist, or was never knocked all land
    // here, and the sheet has nothing useful to say about any of them.
    return null
  }
}

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

  return (
    <WalkSheet turfName={turfName} payload={payload} printedAt={new Date()} />
  )
}
