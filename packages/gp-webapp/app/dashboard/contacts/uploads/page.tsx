import { notFound } from 'next/navigation'
import { SERVE_IMPORT_CONTACTS_FLAG } from '@goodparty_org/contracts'
import pageMetaData from 'helpers/metadataHelper'
import { getFlagVariants } from '@shared/experiments/getFlagVariants'
import serveAccess from '../../shared/serveAccess'
import DashboardLayout from '../../shared/DashboardLayout'
import { UploadHistory } from '../crm/import/UploadHistory'
import { UPLOAD_HISTORY_PATH } from '../crm/import/importContactsCopy'

const meta = pageMetaData({
  title: 'Upload history | GoodParty.org',
  description: 'Files you have imported into your constituents',
  slug: UPLOAD_HISTORY_PATH,
})
export const metadata = meta
export const dynamic = 'force-dynamic'

export default async function Page(): Promise<React.JSX.Element> {
  await serveAccess()

  const variants = await getFlagVariants()
  if (variants?.[SERVE_IMPORT_CONTACTS_FLAG]?.value !== 'on') notFound()

  return (
    <DashboardLayout pathname="/dashboard/contacts" showAlert={false}>
      <UploadHistory />
    </DashboardLayout>
  )
}
