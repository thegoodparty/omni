import { notFound } from 'next/navigation'
import pageMetaData from 'helpers/metadataHelper'
import Paper from '@shared/utils/Paper'
import DashboardLayout from 'app/(dashboard)/shared/DashboardLayout'
import { parsePositiveListId } from 'app/(dashboard)/outreach/util/parsePositiveListId.util'
import { issueCaptureAccess } from '../../issueCaptureAccess'
import PendingMemoList from './components/PendingMemoList'

export const metadata = pageMetaData({
  title: 'Notes to review | GoodParty.org',
  description: 'Notes to review',
  slug: '/issue-capture',
})

export const dynamic = 'force-dynamic'

// Reached from the report's "waiting for review" and the turf's "Notes to
// review", never from the nav.
export default async function Page({
  params,
}: {
  params: Promise<{ outreachId: string }>
}): Promise<React.JSX.Element> {
  const { isServe } = await issueCaptureAccess()
  const outreachId = parsePositiveListId((await params).outreachId)
  if (outreachId === undefined) notFound()

  return (
    <DashboardLayout
      pathname={isServe ? '/constituent-outreach' : '/outreach'}
      showAlert={false}
    >
      <Paper className="min-h-full">
        <PendingMemoList outreachId={outreachId} isServe={isServe} />
      </Paper>
    </DashboardLayout>
  )
}
