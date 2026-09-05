import { notFound } from 'next/navigation'
import pageMetaData from 'helpers/metadataHelper'
import VolunteerWalkPage from './VolunteerWalkPage'

export const metadata = pageMetaData({
  title: 'Walk a route | GoodParty.org',
  description: 'Volunteer door-knocking walk',
  slug: '/volunteer/door-knocking',
})

// gp-api parses this param with ParseIntPipe, which 400s rather than 404s on
// a non-numeric id — the same guard the candidate print route uses for the
// same reason (`print/[turfId]/page.tsx`): a hand-mangled URL reads as "no
// such route" to the volunteer who typed it, and there is no reason to ask
// the API about it at all.
export default async function Page({
  params,
}: {
  params: Promise<{ turfId: string }>
}): Promise<React.JSX.Element> {
  const { turfId } = await params
  if (!/^\d+$/.test(turfId)) notFound()

  return <VolunteerWalkPage turfId={Number(turfId)} />
}
