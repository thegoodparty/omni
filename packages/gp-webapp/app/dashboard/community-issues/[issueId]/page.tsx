import { notFound } from 'next/navigation'
import pageMetaData from 'helpers/metadataHelper'
import { serverRequest } from 'gpApi/server-request'
import serveAccess from '../../shared/serveAccess'
import DashboardLayout from '../../shared/DashboardLayout'
import IssueDetail from '../components/IssueDetail'

const meta = pageMetaData({
  title: 'Community Issue | GoodParty.org',
  description: 'Community issue detail',
  slug: '/dashboard/community-issues',
})
export const metadata = meta
export const dynamic = 'force-dynamic'

type Props = {
  params: Promise<{ issueId: string }>
}

export default async function Page({
  params,
}: Props): Promise<React.JSX.Element> {
  await serveAccess()

  const { issueId } = await params

  let result
  try {
    result = await serverRequest('GET /v1/community-issues/:id', {
      id: issueId,
    })
  } catch {
    notFound()
  }

  return (
    <DashboardLayout
      pathname="/dashboard/community-issues"
      showAlert={false}
      wrapperClassName="!p-0"
    >
      <IssueDetail issue={result.data} />
    </DashboardLayout>
  )
}
