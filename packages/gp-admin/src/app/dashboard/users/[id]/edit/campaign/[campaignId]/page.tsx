import { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { SdkError } from '@goodparty_org/sdk'
import {
  getCampaign,
  type EnrichedCampaign,
} from '@/app/dashboard/campaigns/actions'
import { getOrganization } from '@/app/dashboard/organizations/actions'
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

  let campaign: EnrichedCampaign
  try {
    campaign = await getCampaign(campaignIdNum)
  } catch (error) {
    if (error instanceof SdkError && error.status === status.NotFound) {
      notFound()
    }
    throw error
  }

  const organization = await getOrganization(`campaign-${campaign.id}`)

  return (
    <EditCampaignClient
      campaign={campaign}
      organization={organization}
      initialDistrictType={organization?.district?.l2Type}
      initialDistrictName={organization?.district?.l2Name}
    />
  )
}
