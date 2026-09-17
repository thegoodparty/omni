import { notFound } from 'next/navigation'
import pageMetaData from 'helpers/metadataHelper'
import candidateAccess from 'app/dashboard/shared/candidateAccess'
import PhoneBankingCallerPage from './PhoneBankingCallerPage'

export const metadata = pageMetaData({
  title: 'Phone banking | GoodParty.org',
  description: 'Work a phone banking list',
  slug: '/dashboard/outreach/phone-banking',
})

export const dynamic = 'force-dynamic'

// Full-page route, like door knocking's walk view — not a step inside the
// legacy outreach create flow. Gated the same way the outreach hub itself
// is (`app/dashboard/outreach/page.tsx`), since this is reached only from
// there.
export default async function Page({
  params,
}: {
  params: Promise<{ listId: string }>
}): Promise<React.JSX.Element> {
  await candidateAccess()

  const { listId } = await params
  // gp-api's ParseIntPipe 400s a non-numeric id rather than 404ing — a
  // hand-mangled URL is "no such list" to the person who typed it, and
  // there's no reason to ask the API about it at all.
  if (!/^\d+$/.test(listId)) notFound()

  return <PhoneBankingCallerPage listId={Number(listId)} />
}
