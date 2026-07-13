import serveAccess from '../../../../shared/serveAccess'
import DashboardLayout from '../../../../shared/DashboardLayout'
import OrdinanceFlowChat from '../../../components/OrdinanceFlowChat'

export const dynamic = 'force-dynamic'

type PageProps = {
  params: Promise<{ slug: string; step: string }>
}

export default async function Page({
  params,
}: PageProps): Promise<React.JSX.Element> {
  await serveAccess()
  const { slug, step } = await params

  return (
    <DashboardLayout
      pathname={`/dashboard/ordinances/solve/${slug}/${step}`}
      showAlert={false}
      wrapperClassName="!p-0"
    >
      <OrdinanceFlowChat slug={slug} step={step} />
    </DashboardLayout>
  )
}
