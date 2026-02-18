import { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { Text } from '@radix-ui/themes'
import { listCampaigns } from '@/app/dashboard/campaigns/actions'
import { CampaignList } from '../../components/CampaignList'
import { EditCampaignClient } from './EditCampaignClient'

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
  const userId = Number(id)
  if (Number.isNaN(userId)) {
    notFound()
  }
  const { data: campaigns } = await listCampaigns(userId)

  if (campaigns.length === 0) {
    return <Text>No campaign found for this user.</Text>
  }

  return (
    <CampaignList
      campaigns={campaigns}
      renderItem={(campaign) => <EditCampaignClient campaign={campaign} />}
    />
  )
}
