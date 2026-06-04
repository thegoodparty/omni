import { Metadata } from 'next'
import { listCampaigns } from '@/app/dashboard/campaigns/actions'
import { CampaignListTable } from '../../campaign/components/CampaignListTable'
import { validateNumericParams } from '@/shared/util/validateNumericParams.util'
import { listOrEmpty } from '@/shared/util/gpClient.util'

export const metadata: Metadata = {
  title: 'Edit Campaign | GP Admin',
  description: 'Edit campaign details',
}

interface EditCampaignPageProps {
  params: Promise<{ id: string }>
}

export default async function EditCampaignPage({
  params,
}: EditCampaignPageProps) {
  const { id } = await params
  const [userId] = validateNumericParams(id)
  const { data: campaigns } = await listOrEmpty(listCampaigns(userId))

  return (
    <CampaignListTable
      campaigns={campaigns}
      basePath={`/dashboard/users/${userId}/edit/campaign`}
    />
  )
}
