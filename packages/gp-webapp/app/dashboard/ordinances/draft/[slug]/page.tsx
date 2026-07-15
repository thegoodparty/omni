import serveAccess from '../../../shared/serveAccess'
import DashboardLayout from '../../../shared/DashboardLayout'
import OrdinanceDraftDocument from '../../components/OrdinanceDraftDocument'

export const dynamic = 'force-dynamic'

type PageProps = { params: Promise<{ slug: string }> }

export default async function Page({
  params,
}: PageProps): Promise<React.JSX.Element> {
  await serveAccess()
  const { slug } = await params
  return (
    <DashboardLayout
      pathname={`/dashboard/ordinances/draft/${slug}`}
      showAlert={false}
    >
      <OrdinanceDraftDocument key={slug} slug={slug} />
    </DashboardLayout>
  )
}
