import { notFound } from 'next/navigation'
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
  if (process.env.NEXT_PUBLIC_POC_IMPORT_CONTACTS_ENABLED !== 'true') {
    notFound()
  }
  await candidateAccess()
  return (
    <DashboardLayout pathname="/dashboard/contacts" showAlert={false}>
      <ImportContactsPocPage />
    </DashboardLayout>
  )
}
