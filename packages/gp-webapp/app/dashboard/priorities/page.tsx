import type { Priority } from '@goodparty_org/contracts'
import pageMetaData from 'helpers/metadataHelper'
import { serverRequest } from 'gpApi/server-request'
import serveAccess from '../shared/serveAccess'
import DashboardLayout from '../shared/DashboardLayout'
import PrioritiesHub from './components/PrioritiesHub'

const meta = pageMetaData({
  title: 'Priorities | GoodParty.org',
  description: 'What you are working on this term',
  slug: '/dashboard/priorities',
})
export const metadata = meta
export const dynamic = 'force-dynamic'

export default async function Page(): Promise<React.JSX.Element> {
  await serveAccess()

  // Priorities are the page. The issue feed only seeds it, so a feed hiccup
  // (or an org whose agent jobs have never run) must not blank the page.
  const [prioritiesResult, issuesResult] = await Promise.all([
    serverRequest('GET /v1/priorities', {}).catch(() => null),
    serverRequest('GET /v1/community-issues', {
      list: 'top_community',
    }).catch(() => null),
  ])

  const priorities: Priority[] = prioritiesResult?.data ?? []
  const issues = issuesResult?.data?.issues ?? []

  return (
    <DashboardLayout
      pathname="/dashboard/priorities"
      showAlert={false}
      wrapperClassName="!p-0"
      navHeader={{ icon: 'target', label: 'Priorities' }}
    >
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-10 px-4 pb-28 pt-6 md:px-6 md:pt-8">
        <PrioritiesHub priorities={priorities} seedIssues={issues} />
      </div>
    </DashboardLayout>
  )
}
