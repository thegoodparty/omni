import pageMetaData from 'helpers/metadataHelper'
import { serverRequest } from 'gpApi/server-request'
import serveAccess from '../shared/serveAccess'
import DashboardLayout from '../shared/DashboardLayout'
import IssueFeedList from './components/IssueFeedList'

const meta = pageMetaData({
  title: 'Community Issues | GoodParty.org',
  description: 'Community issues feed',
  slug: '/dashboard/community-issues',
})
export const metadata = meta
export const dynamic = 'force-dynamic'

export default async function Page(): Promise<React.JSX.Element> {
  await serveAccess()

  const [topCommunity, trending] = await Promise.all([
    serverRequest('GET /v1/community-issues', { list: 'top_community' }),
    serverRequest('GET /v1/community-issues', { list: 'trending' }),
  ])

  return (
    <DashboardLayout
      pathname="/dashboard/community-issues"
      showAlert={false}
      wrapperClassName="!p-0"
    >
      <IssueFeedList
        topCommunity={topCommunity.data}
        trending={trending.data}
      />
    </DashboardLayout>
  )
}
