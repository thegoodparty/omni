import { Heading, Separator } from '@radix-ui/themes'
import type { Campaign } from '@goodparty_org/sdk'
import type { ReactNode } from 'react'

interface CampaignListProps {
  campaigns: Campaign[]
  renderItem: (campaign: Campaign) => ReactNode
}

export function CampaignList({ campaigns, renderItem }: CampaignListProps) {
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
          {renderItem(campaign)}
        </div>
      ))}
    </>
  )
}
