import { Website } from '@/app/[vanityPath]/types/website.type'
import { Metadata } from 'next'
import { getCandidateHeadline } from './getCandidateHeadline'

export const getCandidateMetaData = (website: Website): Metadata => {
  const mainContent = website.content?.main
  const title =
    website.legacyTitleOverride ||
    getCandidateHeadline(website.campaign?.user) ||
    'GoodParty.org Candidate Sites'
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
