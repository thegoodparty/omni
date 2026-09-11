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
  const result = await serverRequest('GET /v1/priorities', {}).catch(() => null)
  const priorities: Priority[] = result?.data ?? []
  const priority = priorities.find((p) => p.id === priorityId)

  if (!priority) notFound()

  return (
    <DashboardLayout
      pathname="/dashboard/priorities"
      showAlert={false}
      wrapperClassName="!p-0"
      navHeader={{ icon: 'clipboard', label: 'Priorities' }}
    >
      <div className="mx-auto flex w-full max-w-2xl flex-col px-4 pb-28 pt-6 md:px-6 md:pt-8">
        <PriorityFlowShell priority={priority} />
      </div>
    </DashboardLayout>
  )
}
