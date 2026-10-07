import { notFound } from 'next/navigation'
import pageMetaData from 'helpers/metadataHelper'
import { issueCaptureFlagGate } from 'app/(dashboard)/issue-capture/issueCaptureAccess'
import VolunteerReviewPage from './components/VolunteerReviewPage'

export const metadata = pageMetaData({
  title: 'Notes to review | GoodParty.org',
  description: 'Notes to review',
  slug: '/volunteer/door-knocking',
})

export const dynamic = 'force-dynamic'

// Reached from the volunteer walk's "Notes to review" line. The volunteer
// layout is the role gate; this checks the flag and, like the walk
// page, refuses a hand-mangled id before asking the API about it.
export default async function Page({
  params,
}: {
  params: Promise<{ turfId: string }>
}): Promise<React.JSX.Element> {
  const { turfId } = await params
  if (!/^\d+$/.test(turfId)) notFound()
  const { isServe } = await issueCaptureFlagGate(
    `/volunteer/door-knocking/${turfId}`,
  )

  return <VolunteerReviewPage turfId={Number(turfId)} isServe={isServe} />
}
