import { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { Text } from '@radix-ui/themes'
import { listCampaigns } from '@/app/dashboard/campaigns/actions'
import { CampaignList } from '../components/CampaignList'
import { CampaignSection } from '../components/CampaignSection'
import { ViewLayout } from '../components/ViewLayout'

export const metadata: Metadata = {
  title: 'Campaign Details | GP Admin',
  description: 'View campaign details',
}

interface CampaignPageProps {
  params: Promise<{ id: string }>
}

export default async function CampaignPage({ params }: CampaignPageProps) {
  const { id } = await params
  const userId = Number(id)
  if (Number.isNaN(userId)) {
    notFound()
  }
  const { data: campaigns } = await listCampaigns(userId)

  if (campaigns.length === 0) {
    return (
      <ViewLayout>
        <Text>No campaign found for this user.</Text>
      </ViewLayout>
    )
  }

  return (
    <ViewLayout>
      <CampaignList
        campaigns={campaigns}
        renderItem={(campaign) => <CampaignSection campaign={campaign} />}
      />
    </ViewLayout>
  )
}
