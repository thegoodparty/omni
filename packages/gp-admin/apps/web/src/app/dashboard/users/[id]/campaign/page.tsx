import { Metadata } from 'next'
import { stubbedCampaign } from '@/data/stubbed-campaign'
import { CampaignSection } from '../components/CampaignSection'
import { ViewLayout } from '../components/ViewLayout'

export const metadata: Metadata = {
  title: 'Campaign Details | GP Admin',
  description: 'View campaign details',
}

export default function CampaignPage() {
  return (
    <ViewLayout>
      <CampaignSection campaign={stubbedCampaign} />
    </ViewLayout>
  )
}
