import pageMetaData from 'helpers/metadataHelper'
import FeatureFlagGuard from '@shared/experiments/FeatureFlagGuard'
import { CHIEF_OF_STAFF_FLAG_KEY } from '@shared/experiments/chiefOfStaffFlag'
import serveAccess from '../../shared/serveAccess'
import DashboardLayout from '../../shared/DashboardLayout'
import { chiefOfStaffArchiveHref } from '../routes'
import ArchiveContent from './components/ArchiveContent'

const meta = pageMetaData({
  title: 'Archive | Chief of Staff | GoodParty.org',
  description: 'Archived Chief of Staff tasks',
  slug: chiefOfStaffArchiveHref(),
})
export const metadata = meta
export const dynamic = 'force-dynamic'

export default async function Page(): Promise<React.JSX.Element> {
  await serveAccess()

  return (
    <FeatureFlagGuard flagKey={CHIEF_OF_STAFF_FLAG_KEY} redirectTo="/dashboard">
      <DashboardLayout pathname={chiefOfStaffArchiveHref()} showAlert={false}>
        <ArchiveContent />
      </DashboardLayout>
    </FeatureFlagGuard>
  )
}
