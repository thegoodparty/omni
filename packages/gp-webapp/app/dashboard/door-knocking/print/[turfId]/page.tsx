import { notFound } from 'next/navigation'
import pageMetaData from 'helpers/metadataHelper'
import candidateAccess from 'app/dashboard/shared/candidateAccess'
import WalkSheet from '../WalkSheet'
import { fetchRoute, fetchTurfName } from '../walkListData'

export const metadata = pageMetaData({
  title: 'Walk list | GoodParty.org',
  description: 'Printable door-knocking walk list',
  slug: '/dashboard/door-knocking/print',
})

export const dynamic = 'force-dynamic'

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
  // gp-api parses this param with ParseIntPipe, which 400s rather than 404s on
  // a non-numeric id. A hand-mangled URL is "no such walk list" to the person
  // who typed it, and there's no reason to ask the API about it at all.
  if (!/^\d+$/.test(turfId)) notFound()

  const [payload, turfName] = await Promise.all([
    fetchRoute(turfId),
    fetchTurfName(turfId),
  ])
  if (!payload) notFound()

  return <WalkSheet turfId={turfId} turfName={turfName} payload={payload} />
}
