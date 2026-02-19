import { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { SdkError } from '@goodparty_org/sdk'
import { getCampaign } from '@/app/dashboard/campaigns/actions'
import { EditCampaignClient } from './EditCampaignClient'

export const metadata: Metadata = {
  title: 'Edit Campaign | GP Admin',
  description: 'Edit campaign details',
}

interface EditCampaignDetailPageProps {
  params: Promise<{ id: string; campaignId: string }>
}

export default async function EditCampaignDetailPage({
  params,
}: EditCampaignDetailPageProps) {
  const { id, campaignId } = await params
  const userId = Number(id)
  const campaignIdNum = Number(campaignId)
  if (Number.isNaN(userId) || Number.isNaN(campaignIdNum)) {
    notFound()
  }

  let campaign
  try {
    campaign = await getCampaign(campaignIdNum)
  } catch (error) {
    if (error instanceof SdkError && error.status === 404) {
      notFound()
    }
    throw error
  }

  return <EditCampaignClient campaign={campaign} />
}
