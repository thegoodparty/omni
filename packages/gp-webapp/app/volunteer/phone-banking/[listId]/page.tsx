import { notFound } from 'next/navigation'
import pageMetaData from 'helpers/metadataHelper'
import PhoneBankingCallerPage from 'app/dashboard/outreach/phone-banking/[listId]/PhoneBankingCallerPage'

export const metadata = pageMetaData({
  title: 'Phone banking | GoodParty.org',
  description: 'Work a phone banking list',
  slug: '/volunteer/phone-banking',
})

export const dynamic = 'force-dynamic'

// Mounts the same caller component the dashboard route does (ENG-11054),
// parametrized via its `surface` prop for the volunteer-appropriate
// affordances (no delete, exits to the assignments list). Gated by
// app/volunteer/layout.tsx's own isActiveOrgVolunteer() check, not
// candidateAccess() — that helper's org/campaign assumptions are the
// dashboard's, not a volunteer's (see VolunteerLayout).
export default async function Page({
  params,
}: {
  params: Promise<{ listId: string }>
}): Promise<React.JSX.Element> {
  const { listId } = await params
  // gp-api's ParseIntPipe 400s a non-numeric id rather than 404ing — a
  // hand-mangled URL is "no such list" to the person who typed it, and
  // there's no reason to ask the API about it at all.
  if (!/^\d+$/.test(listId)) notFound()

  return (
    <PhoneBankingCallerPage
      listId={Number(listId)}
      surface={{
        exitHref: '/volunteer',
        exitLabel: 'Assignments',
        showDeleteAction: false,
      }}
    />
  )
}
