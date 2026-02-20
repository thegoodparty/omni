import { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { SdkError, type Campaign } from '@goodparty_org/sdk'
import { getCampaign } from '@/app/dashboard/campaigns/actions'
import { CampaignSection } from '../../components/CampaignSection'
import { ViewLayout } from '../../components/ViewLayout'
import { status } from '@poppanator/http-constants'
import { validateNumericParams } from '@/shared/util/validateNumericParams.util'

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

  return (
    <ViewLayout>
      <CampaignSection campaign={campaign} />
    </ViewLayout>
  )
}
