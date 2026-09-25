import { notFound } from 'next/navigation'
import pageMetaData from 'helpers/metadataHelper'
import candidateAccess from 'app/dashboard/shared/candidateAccess'
import { CampaignDetailsPage } from './CampaignDetailsPage'

export const metadata = pageMetaData({
  title: 'Door knocking campaign | GoodParty.org',
  description: 'A door knocking campaign and its turfs',
  slug: '/dashboard/door-knocking',
})

export const dynamic = 'force-dynamic'

// Addressed by the ANCHOR Outreach id, not a turf id: a campaign has no row
// of its own, it is the anchor envelope plus every sibling pointing at it,
// and `GET /v1/door-knocking/campaigns/:anchorId` is keyed the same way.
export default async function Page({
  params,
}: {
  params: Promise<{ anchorId: string }>
}): Promise<React.JSX.Element> {
  await candidateAccess()

  const { anchorId } = await params
  // gp-api's ParseIntPipe 400s a non-numeric id rather than 404ing — a
  // hand-mangled URL is "no such campaign" to whoever typed it, and there is
  // no reason to ask the API about it.
  if (!/^\d+$/.test(anchorId)) notFound()

  return <CampaignDetailsPage anchorId={Number(anchorId)} />
}
