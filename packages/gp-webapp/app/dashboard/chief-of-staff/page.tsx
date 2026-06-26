import pageMetaData from 'helpers/metadataHelper'
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
    <DashboardLayout
      pathname={chiefOfStaffHref()}
      showAlert={false}
      wrapperClassName="!p-0"
      navHeader={{ icon: 'sparkles', label: 'Chief of Staff' }}
    >
      <DashboardContent />
    </DashboardLayout>
  )
}
