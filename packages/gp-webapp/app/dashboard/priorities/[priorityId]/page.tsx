import { notFound } from 'next/navigation'
import type { Priority } from '@goodparty_org/contracts'
import pageMetaData from 'helpers/metadataHelper'
import { serverRequest } from 'gpApi/server-request'
import serveAccess from '../../shared/serveAccess'
import DashboardLayout from '../../shared/DashboardLayout'
import PriorityFlowShell from '../components/PriorityFlowShell'

const meta = pageMetaData({
  title: 'Priorities | GoodParty.org',
  description: 'Work a priority forward',
  slug: '/dashboard/priorities',
})
export const metadata = meta
export const dynamic = 'force-dynamic'

export default async function Page({
  params,
}: {
  params: Promise<{ priorityId: string }>
}): Promise<React.JSX.Element> {
  await serveAccess()
  const { priorityId } = await params

  // There is no GET /v1/priorities/:id, so the list is the read. Fine at the
  // handful of priorities an official actually holds.
  //
  // The issue feed rides along because the research steps hand its ids to the
  // agent: those issues are already synthesized and carry sources, so they are
  // the first thing worth reading about a priority. Best-effort, since an org
  // whose agent jobs have never run still has a working flow.
  const [result, issuesResult] = await Promise.all([
    serverRequest('GET /v1/priorities', {}).catch(() => null),
    serverRequest('GET /v1/community-issues', {
      list: 'top_community',
    }).catch(() => null),
  ])
  const priorities: Priority[] = result?.data ?? []
  const priority = priorities.find((p) => p.id === priorityId)

  if (!priority) notFound()

  const issues = (issuesResult?.data?.issues ?? []).map((issue) => ({
    id: issue.id,
    title: issue.title,
  }))

  return (
    // No navHeader: the flow owns the full viewport height and carries its own
    // stepper and title, the same as ordinances/solve/[slug]/[step].
    <DashboardLayout
      pathname="/dashboard/priorities"
      showAlert={false}
      wrapperClassName="!p-0"
    >
      <PriorityFlowShell priority={priority} issues={issues} />
    </DashboardLayout>
  )
}
