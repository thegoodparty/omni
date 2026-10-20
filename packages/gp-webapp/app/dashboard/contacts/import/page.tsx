import pageMetaData from 'helpers/metadataHelper'
import candidateAccess from '../../shared/candidateAccess'
import DashboardLayout from '../../shared/DashboardLayout'
import { ImportContactsPocPage } from './ImportContactsPocPage'

const meta = pageMetaData({
  title: 'Import contacts | GoodParty.org',
  description: 'Import contacts from a file.',
  slug: '/dashboard/contacts/import',
})
export const metadata = meta
export const dynamic = 'force-dynamic'

export default async function Page(): Promise<React.JSX.Element> {
  await candidateAccess()
  return (
    <DashboardLayout pathname="/dashboard/contacts" showAlert={false}>
      <ImportContactsPocPage />
    </DashboardLayout>
  )
}
