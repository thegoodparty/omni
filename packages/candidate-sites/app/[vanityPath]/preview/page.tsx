import PreviewPageClient from './PreviewPageClient'

interface PageProps {
  params: Promise<{ vanityPath: string }>
  searchParams: Promise<{ id?: string }>
}

export const revalidate = 3600
export const dynamic = 'force-dynamic'

export default async function CandidateWebsitePage({
  params,
  searchParams,
}: PageProps) {
  const { vanityPath } = await params

  return <PreviewPageClient vanityPath={vanityPath} />
}
