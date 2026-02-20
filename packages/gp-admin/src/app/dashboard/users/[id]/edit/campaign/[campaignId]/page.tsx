import { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { SdkError, type Campaign } from '@goodparty_org/sdk'
import { getCampaign } from '@/app/dashboard/campaigns/actions'
import { EditCampaignClient } from './EditCampaignClient'
import { status } from '@poppanator/http-constants'
import { validateNumericParams } from '@/shared/util/validateNumericParams.util'

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
  const [, campaignIdNum] = validateNumericParams(id, campaignId)

  let campaign: Campaign
  try {
    campaign = await getCampaign(campaignIdNum)
  } catch (error) {
    if (error instanceof SdkError && error.status === status.NotFound) {
      notFound()
    }
    throw error
  }

  return <EditCampaignClient campaign={campaign} />
}
