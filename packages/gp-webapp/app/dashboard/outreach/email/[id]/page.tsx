import { notFound } from 'next/navigation'
import pageMetaData from 'helpers/metadataHelper'
import candidateAccess from 'app/dashboard/shared/candidateAccess'
import { EmailStatusPage } from '../../v2/email/EmailStatusPage'

export const metadata = pageMetaData({
  title: 'Email | GoodParty.org',
  description: 'See how your email is going.',
  slug: '/dashboard/outreach/email',
})
export const dynamic = 'force-dynamic'

export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>
}): Promise<React.JSX.Element> {
  await candidateAccess()
  const id = Number((await params).id)
  if (!Number.isInteger(id) || id <= 0) notFound()
  return <EmailStatusPage id={id} />
}
