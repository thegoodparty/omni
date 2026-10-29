import pageMetaData from 'helpers/metadataHelper'
import DashboardLayout from '../../shared/DashboardLayout'
import { UploadHistory } from '../crm/import/UploadHistory'
import { UPLOAD_HISTORY_PATH } from '../crm/import/importContactsCopy'
import { importContactsAccess } from './importContactsAccess'

const meta = pageMetaData({
  title: 'Upload history | GoodParty.org',
  description: 'Files you have imported',
  slug: UPLOAD_HISTORY_PATH,
})
export const metadata = meta
export const dynamic = 'force-dynamic'

export default async function Page(): Promise<React.JSX.Element> {
  const { isWin } = await importContactsAccess()

  return (
    <DashboardLayout pathname="/dashboard/contacts" showAlert={false}>
      <UploadHistory isWin={isWin} />
    </DashboardLayout>
  )
}
