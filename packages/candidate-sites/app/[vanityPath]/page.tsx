import { notFound } from 'next/navigation'
import { fetchHelper } from '@/helpers/fetchHelper'
import WebsitePage from './components/WebsitePage'
import { Website } from './types/website.type'
import { getCandidateMetaData } from '../shared/utils/candidateMetaData'
import { getImageDimensionsServer, ImageDimensions } from '../shared/utils/getImageDimensions'

export interface PageProps {
  params: Promise<{ vanityPath: string }>
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>
}

async function getWebsite({
  vanityPath,
}: {
  vanityPath: string
}): Promise<Website | null> {
  return await fetchHelper<Website>(`websites/${vanityPath}/view`)
}

export const revalidate = 3600
export const dynamic = 'force-dynamic'

export async function generateMetadata({ params }: PageProps) {
  const website = await getWebsite(await params)

  if (!website) {
    notFound()
  }

  return getCandidateMetaData(website)
}

export default async function CandidateWebsitePage({ params, searchParams }: PageProps) {
  const website = await getWebsite(await params)
  const { privacy } = await searchParams

  if (!website) {
    notFound()
  }

  const image = website.content?.main?.image
  let imageDimensions: ImageDimensions | undefined = undefined

  // Example: Get image dimensions on the server
  // You can uncomment this to use the server-side dimension function
  if (image) {
    try {
      imageDimensions = await getImageDimensionsServer(image)
      console.log('Image dimensions:', imageDimensions)
    } catch (error) {
      console.error('Failed to get image dimensions:', error)
    }
  }

  return (
    <>
      {/* 
      <WebsiteViewTracker vanityPath={website.vanityPath} />
     */}
      <WebsitePage website={website} imageDimensions={imageDimensions} privacyPolicy={privacy==='true'} />
    </>
  )
}
