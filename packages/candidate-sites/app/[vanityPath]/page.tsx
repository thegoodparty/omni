import { notFound } from 'next/navigation'
import { fetchHelper } from '@/helpers/fetchHelper'
import WebsitePage from './components/WebsitePage'
import { Website } from './types/website.type'

async function getWebsite({ vanityPath }: { vanityPath: string }): Promise<Website | null> {
  return await fetchHelper<Website>(`websites/${vanityPath}/view`)
}

export const revalidate = 3600
export const dynamic = 'force-dynamic'

export async function generateMetadata({ params }: { params: { vanityPath: string } }) {
  const website = await getWebsite(await params)

  if (!website) {
    notFound()
  }

  return {
    title: `${website.content?.main?.title}`,
    description: website.content?.main?.tagline,
    other: {
      isCandidateWebsite: true,
    },
  }
}

export default async function CandidateWebsitePage({ params }: { params: { vanityPath: string } }) {
  const website = await getWebsite(await params)

  if (!website) {
    notFound()
  }

  return (
    <>
      {/* <WebsiteViewTracker vanityPath={website.vanityPath} />
     */}
      <WebsitePage website={website} />
    </>
  )
}
