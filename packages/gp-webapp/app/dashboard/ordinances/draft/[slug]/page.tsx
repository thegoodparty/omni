import { notFound } from 'next/navigation'
import pageMetaData from 'helpers/metadataHelper'
import { serverRequest } from 'gpApi/server-request'
import type { Ordinance } from '@goodparty_org/contracts'
import serveAccess from '../../../shared/serveAccess'
import DashboardLayout from '../../../shared/DashboardLayout'
import DraftDetail from '../../components/DraftDetail'

const meta = pageMetaData({
  title: 'Draft | GoodParty.org',
  description: 'Read, review, and edit an ordinance draft',
  slug: '/dashboard/ordinances/draft',
})
export const metadata = meta
export const dynamic = 'force-dynamic'

type PageProps = {
  params: Promise<{ slug: string }>
}

export default async function Page({
  params,
}: PageProps): Promise<React.JSX.Element> {
  await serveAccess()
  const { slug } = await params
  // An unknown or foreign slug makes serverRequest throw (ofetch throws on
  // 4xx/5xx); render a 404 rather than an unhandled error page.
  let ordinance: Ordinance
  try {
    const { data } = await serverRequest('GET /v1/ordinances/:slug', { slug })
    ordinance = data
  } catch {
    notFound()
  }

  return (
    <DashboardLayout
      pathname="/dashboard/ordinances"
      showAlert={false}
      wrapperClassName="!p-0"
      navHeader={{ icon: 'scroll', label: 'Ordinances' }}
    >
      <DraftDetail ordinance={ordinance} />
    </DashboardLayout>
  )
}
