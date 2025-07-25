import PreviewPageClient from './PreviewPageClient'


export const revalidate = 3600
export const dynamic = 'force-dynamic'

export default async function CandidateWebsitePage() {

  return <PreviewPageClient />
}
