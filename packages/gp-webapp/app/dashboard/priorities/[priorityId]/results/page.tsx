import { notFound } from 'next/navigation'
import pageMetaData from 'helpers/metadataHelper'
import { serverRequest } from 'gpApi/server-request'
import { getFlagVariants } from '@shared/experiments/getFlagVariants'
import { SERVE_CITIZEN_PANELS_FLAG_KEY } from '@shared/experiments/serveCitizenPanelsFlag'
import serveAccess from '../../../shared/serveAccess'
import DashboardLayout from '../../../shared/DashboardLayout'
import { PriorityResultsLoader } from './components/PriorityResultsView'

const meta = pageMetaData({
  title: 'Priorities | GoodParty.org',
  description: 'What your outreach on a priority brought back',
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

  const variants = await getFlagVariants()
  if (variants?.[SERVE_CITIZEN_PANELS_FLAG_KEY]?.value !== 'on') notFound()

  const priorityResult = await serverRequest('GET /v1/priorities/:id', {
    id: priorityId,
  }).catch(() => null)

  const priority = priorityResult?.data
  if (!priority) notFound()

  return (
    <DashboardLayout pathname="/dashboard/priorities" showAlert={false}>
      <PriorityResultsLoader priorityId={priority.id} title={priority.title} />
    </DashboardLayout>
  )
}
