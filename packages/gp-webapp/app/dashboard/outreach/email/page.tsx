import pageMetaData from 'helpers/metadataHelper'
import candidateAccess from 'app/dashboard/shared/candidateAccess'
import { EmailFlowPage } from '../v2/email/EmailFlowPage'

export const metadata = pageMetaData({
  title: 'Email | GoodParty.org',
  description: 'Email your voters.',
  slug: '/dashboard/outreach/email',
})
export const dynamic = 'force-dynamic'

export default async function Page(): Promise<React.JSX.Element> {
  await candidateAccess()
  return <EmailFlowPage />
}
