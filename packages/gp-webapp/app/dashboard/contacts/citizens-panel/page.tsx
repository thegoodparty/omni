import { notFound } from 'next/navigation'
import pageMetaData from 'helpers/metadataHelper'
import { serverRequest } from 'gpApi/server-request'
import { getFlagVariants } from '@shared/experiments/getFlagVariants'
import { SERVE_CITIZEN_PANELS_FLAG_KEY } from '@shared/experiments/serveCitizenPanelsFlag'
import serveAccess from '../../shared/serveAccess'
import DashboardLayout from '../../shared/DashboardLayout'
import { CitizensPanelView } from './components/CitizensPanelView'
import { CITIZENS_PANEL_PATH } from './citizensPanelCopy'

const meta = pageMetaData({
  title: 'Civic panel | GoodParty.org',
  description: 'Who is on your civic panel',
  slug: CITIZENS_PANEL_PATH,
})
export const metadata = meta
export const dynamic = 'force-dynamic'

export default async function Page(): Promise<React.JSX.Element> {
  await serveAccess()

  const variants = await getFlagVariants()
  if (variants?.[SERVE_CITIZEN_PANELS_FLAG_KEY]?.value !== 'on') notFound()

  const [summaryResult, representationResult] = await Promise.all([
    serverRequest('GET /v1/contacts/civic-panel', {}).catch(() => null),
    serverRequest('GET /v1/contacts/civic-panel/representation', {}).catch(
      () => null,
    ),
  ])

  const summary = summaryResult?.data
  if (!summary) notFound()

  return (
    <DashboardLayout pathname="/dashboard/contacts" showAlert={false}>
      <CitizensPanelView
        summary={summary}
        representation={representationResult?.data ?? null}
      />
    </DashboardLayout>
  )
}
