import { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { listCampaigns } from '@/app/dashboard/campaigns/actions'
import { CampaignListTable } from '../../campaign/components/CampaignListTable'

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

  return (
    <CampaignListTable
      campaigns={campaigns}
      basePath={`/dashboard/users/${userId}/edit/campaign`}
    />
  )
}
