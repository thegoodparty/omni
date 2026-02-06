import { Metadata } from 'next'
import { stubbedCampaign } from '@/data/stubbed-campaign'
import { CampaignSection } from '../components/CampaignSection'
import { ViewLayout } from '../components/ViewLayout'

export const metadata: Metadata = {
  title: 'Campaign Details | GP Admin',
  description: 'View campaign details',
}

interface PageProps {
  params: Promise<{ id: string }>
}

export default async function CampaignPage({ params }: PageProps) {
  const { id } = await params
  // TODO: Replace stubbed data with API call using id
  void id

  return (
    <ViewLayout userId={id}>
      <CampaignSection campaign={stubbedCampaign} />
    </ViewLayout>
  )
}
