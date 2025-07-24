import { notFound } from 'next/navigation'
import WebsitePage from '../components/WebsitePage'
import { Website } from '../types/website.type'

interface PageProps {
  params: Promise<{ vanityPath: string }>
  searchParams: Promise<{ hash?: string }>
}

function decodeWebsiteHash(hash: string): Website | null {
  try {
    const jsonString = decodeURIComponent(escape(atob(hash)))
    return JSON.parse(jsonString)
  } catch (error) {
    console.error('Failed to decode website hash:', error)
    return null
  }
}

export const revalidate = 3600
export const dynamic = 'force-dynamic'

export default async function CandidateWebsitePage({ params, searchParams }: PageProps) {
  const search = await searchParams
  const hash = search.hash
  
  if (!hash) {
    notFound()
  }

  const website = decodeWebsiteHash(hash)

  if (!website) {
    notFound()
  }

  return (
    <>
      <WebsitePage website={website} isPreview/>
    </>
  )
}
