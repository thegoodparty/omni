import pageMetaData from 'helpers/metadataHelper'
import FeatureFlagGuard from '@shared/experiments/FeatureFlagGuard'
import { CHIEF_OF_STAFF_FLAG_KEY } from '@shared/experiments/chiefOfStaffFlag'
import serveAccess from '../shared/serveAccess'
import DashboardLayout from '../shared/DashboardLayout'
import { chiefOfStaffHref } from './routes'
import DashboardContent from './components/DashboardContent'

const meta = pageMetaData({
  title: 'Chief of Staff | GoodParty.org',
  description: 'Your virtual chief of staff',
  slug: chiefOfStaffHref(),
})
export const metadata = meta
export const dynamic = 'force-dynamic'

export default async function Page(): Promise<React.JSX.Element> {
  await serveAccess()

  return (
    <FeatureFlagGuard flagKey={CHIEF_OF_STAFF_FLAG_KEY} redirectTo="/dashboard">
      <DashboardLayout pathname={chiefOfStaffHref()} showAlert={false}>
        <DashboardContent />
      </DashboardLayout>
    </FeatureFlagGuard>
  )
}
