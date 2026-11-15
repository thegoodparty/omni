import pageMetaData from 'helpers/metadataHelper'
import { UploadDetail } from '../../crm/import/UploadDetail'
import { UPLOAD_HISTORY_PATH } from '../../crm/import/importContactsCopy'
import { importContactsAccess } from '../importContactsAccess'

const meta = pageMetaData({
  title: 'Import | GoodParty.org',
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
  const { isWin } = await importContactsAccess()

  const { uploadId } = await params

  return <UploadDetail uploadId={uploadId} isWin={isWin} />
}
