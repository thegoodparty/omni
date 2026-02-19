import { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { listCampaigns } from '@/app/dashboard/campaigns/actions'
import { CampaignListTable } from './components/CampaignListTable'
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

  return (
    <ViewLayout>
      <CampaignListTable
        campaigns={campaigns}
        basePath={`/dashboard/users/${userId}/campaign`}
      />
    </ViewLayout>
  )
}
