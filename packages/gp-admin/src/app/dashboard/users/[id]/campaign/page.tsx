import { Metadata } from 'next'
import { listCampaigns } from '@/app/dashboard/campaigns/actions'
import { CampaignListTable } from './components/CampaignListTable'
import { ViewLayout } from '../components/ViewLayout'
import { validateNumericParams } from '@/shared/util/validateNumericParams.util'

export const metadata: Metadata = {
  title: 'Campaign Details | GP Admin',
  description: 'View campaign details',
}

interface CampaignPageProps {
  params: Promise<{ id: string }>
}

export default async function CampaignPage({ params }: CampaignPageProps) {
  const { id } = await params
  const [userId] = validateNumericParams(id)
  const { data: campaigns } = await listCampaigns(userId)

  return (
    <ViewLayout>
      <CampaignListTable
        campaigns={campaigns}
        basePath={`/dashboard/users/${userId}/campaign`}
      />
    </ViewLayout>
  )
}
