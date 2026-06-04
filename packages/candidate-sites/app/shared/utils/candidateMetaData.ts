import { Website } from '@/app/[vanityPath]/types/website.type'
import { Metadata } from 'next'

export const getCandidateMetaData = (website: Website): Metadata => {
  const mainContent = website.content?.main
  const title = mainContent?.title || 'GoodParty.org Candidate Sites'
  const description = mainContent?.tagline || 'GoodParty.org Candidate Sites'

  return {
    title,
    description,
    openGraph: {
      images: mainContent?.image,
      title: title,
      description: description,
    },
  }
}
