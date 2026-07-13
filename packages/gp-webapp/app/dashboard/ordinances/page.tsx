import type { Priority } from '@goodparty_org/contracts'
import pageMetaData from 'helpers/metadataHelper'
import { serverRequest } from 'gpApi/server-request'
import serveAccess from '../shared/serveAccess'
import DashboardLayout from '../shared/DashboardLayout'
import MyOrdinancesSection from './components/MyOrdinancesSection'
import MyPriorityIssuesSection from './components/MyPriorityIssuesSection'

const meta = pageMetaData({
  title: 'Ordinances | GoodParty.org',
  description: 'Draft and manage local ordinances',
  slug: '/dashboard/ordinances',
})
export const metadata = meta
export const dynamic = 'force-dynamic'

export default async function Page(): Promise<React.JSX.Element> {
  await serveAccess()

  // Ordinances are required; priorities are best-effort (the seed-an-ordinance
  // section) so a priorities hiccup never blanks the whole page.
  const [ordinances, prioritiesResult] = await Promise.all([
    serverRequest('GET /v1/ordinances', {}),
    serverRequest('GET /v1/priorities', {}).catch(() => null),
  ])
  const priorities: Priority[] = prioritiesResult?.data ?? []

  return (
    <DashboardLayout
      pathname="/dashboard/ordinances"
      showAlert={false}
      wrapperClassName="!p-0"
      navHeader={{ icon: 'scroll', label: 'Ordinances' }}
    >
      <div className="mx-auto flex w-full max-w-4xl flex-col gap-10 px-4 py-6 md:px-6 md:py-8">
        <MyOrdinancesSection
          items={ordinances.data.items}
          counts={ordinances.data.counts}
        />
        <MyPriorityIssuesSection priorities={priorities} />
      </div>
    </DashboardLayout>
  )
}
