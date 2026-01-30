'use client'

import { Badge } from '@radix-ui/themes'
import { formatTimestampString } from '@/lib/utils/date'
import { useUser } from '../UserProvider'
import { InfoCard } from './InfoCard'
import { DataRow } from './DataRow'

export function HubSpotSection() {
  const user = useUser()
  const hubSpotUpdates = user.data.hubSpotUpdates
  if (!hubSpotUpdates) return null

  return (
    <InfoCard title="HubSpot Data">
      <DataRow label="P2P Sent">{hubSpotUpdates.p2p_sent}</DataRow>
      <DataRow label="P2P Campaigns">{hubSpotUpdates.p2p_campaigns}</DataRow>
      <DataRow label="Pro Candidate">
        <Badge
          color={hubSpotUpdates.pro_candidate === 'Yes' ? 'green' : 'gray'}
        >
          {hubSpotUpdates.pro_candidate}
        </Badge>
      </DataRow>
      <DataRow label="Verified Candidate">
        <Badge
          color={
            hubSpotUpdates.verified_candidates === 'Yes' ? 'green' : 'orange'
          }
        >
          {hubSpotUpdates.verified_candidates}
        </Badge>
      </DataRow>
      <DataRow label="Date Verified">
        {formatTimestampString(hubSpotUpdates.date_verified)}
      </DataRow>
    </InfoCard>
  )
}
