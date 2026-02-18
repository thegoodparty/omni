import { Metadata } from 'next'
import { Heading, Separator, Text } from '@radix-ui/themes'
import { listCampaigns } from '@/app/dashboard/campaigns/actions'
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
  const { data: campaigns } = await listCampaigns(Number(id))

  if (campaigns.length === 0) {
    return <Text>No campaign found for this user.</Text>
  }

  return (
    <>
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
          <EditCampaignClient campaign={campaign} />
        </div>
      ))}
    </>
  )
}
