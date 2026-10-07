import { notFound } from 'next/navigation'
import {
  emptyPriorityStatus,
  parsePriorityStatus,
} from '@goodparty_org/contracts'
import pageMetaData from 'helpers/metadataHelper'
import { serverRequest } from 'gpApi/server-request'
import serveAccess from '../../shared/serveAccess'
import DashboardLayout from '../../shared/DashboardLayout'
import { PriorityWorkspace } from './components/PriorityWorkspace'

const meta = pageMetaData({
  title: 'Priorities | GoodParty.org',
  description: 'Work a priority forward',
  slug: '/priorities',
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

  const [priorityResult, statusResult] = await Promise.all([
    serverRequest('GET /v1/priorities/:id', { id: priorityId }).catch(
      () => null,
    ),
    // The rail opens on the empty seven rather than on nothing if this read
    // fails; the first turn reconciles it.
    serverRequest('GET /v1/priorities/:id/status', { id: priorityId }).catch(
      () => null,
    ),
  ])

  const priority = priorityResult?.data
  if (!priority) notFound()

  const status = statusResult?.data
    ? parsePriorityStatus(statusResult.data.status)
    : emptyPriorityStatus()

  return (
    // No navHeader and no chat dock: this page is itself one chat, and the
    // dock's fixed bar would stack a second composer over this one's.
    <DashboardLayout
      pathname="/priorities"
      showAlert={false}
      wrapperClassName="!p-0"
      hideChatDock
    >
      <PriorityWorkspace
        priorityId={priority.id}
        title={priority.title}
        description={priority.description}
        initialStatus={status}
        initialNextAction={statusResult?.data?.nextAction ?? null}
      />
    </DashboardLayout>
  )
}
