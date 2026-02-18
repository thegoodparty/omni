import { Metadata } from 'next'
import { Heading, Separator, Text } from '@radix-ui/themes'
import { listCampaigns } from '@/app/dashboard/campaigns/actions'
import { CampaignSection } from '../components/CampaignSection'
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
  const { data: campaigns } = await listCampaigns(Number(id))

  if (campaigns.length === 0) {
    return (
      <ViewLayout>
        <Text>No campaign found for this user.</Text>
      </ViewLayout>
    )
  }

  return (
    <ViewLayout>
      {campaigns.map((campaign, index) => (
        <div key={campaign.id}>
          {campaigns.length > 1 && (
            <>
              {index > 0 && <Separator size="4" />}
              <Heading as="h2" size="5" mb="4" mt={index > 0 ? '6' : '0'}>
                Campaign #{index + 1}
              </Heading>
            </>
          )}
          <CampaignSection campaign={campaign} />
        </div>
      ))}
    </ViewLayout>
  )
}
