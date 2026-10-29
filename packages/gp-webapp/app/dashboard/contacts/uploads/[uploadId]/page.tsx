import { notFound } from 'next/navigation'
import { SERVE_IMPORT_CONTACTS_FLAG } from '@goodparty_org/contracts'
import pageMetaData from 'helpers/metadataHelper'
import { getFlagVariants } from '@shared/experiments/getFlagVariants'
import serveAccess from '../../../shared/serveAccess'
import DashboardLayout from '../../../shared/DashboardLayout'
import { UploadDetail } from '../../crm/import/UploadDetail'
import { UPLOAD_HISTORY_PATH } from '../../crm/import/importContactsCopy'

const meta = pageMetaData({
  title: 'Upload | GoodParty.org',
  description: 'What happened to each row of an imported file',
  slug: UPLOAD_HISTORY_PATH,
})
export const metadata = meta
export const dynamic = 'force-dynamic'

export default async function Page({
  params,
}: {
  params: Promise<{ uploadId: string }>
}): Promise<React.JSX.Element> {
  await serveAccess()

  const variants = await getFlagVariants()
  if (variants?.[SERVE_IMPORT_CONTACTS_FLAG]?.value !== 'on') notFound()

  const { uploadId } = await params

  return (
    <DashboardLayout pathname="/dashboard/contacts" showAlert={false}>
      <UploadDetail uploadId={uploadId} />
    </DashboardLayout>
  )
}
