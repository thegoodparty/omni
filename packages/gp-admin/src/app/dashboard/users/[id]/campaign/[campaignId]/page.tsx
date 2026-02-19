import { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { getCampaign } from '@/app/dashboard/campaigns/actions'
import { CampaignSection } from '../../components/CampaignSection'
import { ViewLayout } from '../../components/ViewLayout'

export const metadata: Metadata = {
  title: 'Campaign Detail | GP Admin',
  description: 'View campaign detail',
}

interface CampaignDetailPageProps {
  params: Promise<{ id: string; campaignId: string }>
}

export default async function CampaignDetailPage({
  params,
}: CampaignDetailPageProps) {
  const { id, campaignId } = await params
  const userId = Number(id)
  const campaignIdNum = Number(campaignId)
  if (Number.isNaN(userId) || Number.isNaN(campaignIdNum)) {
    notFound()
  }

  const campaign = await getCampaign(campaignIdNum)
  if (!campaign) {
    notFound()
  }

  return (
    <ViewLayout>
      <CampaignSection campaign={campaign} />
    </ViewLayout>
  )
}
