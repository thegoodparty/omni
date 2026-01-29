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
      <DataRow label="P2P Sent" value={hubSpotUpdates.p2p_sent} />
      <DataRow label="P2P Campaigns" value={hubSpotUpdates.p2p_campaigns} />
      <DataRow
        label="Pro Candidate"
        value={
          <Badge
            color={hubSpotUpdates.pro_candidate === 'Yes' ? 'green' : 'gray'}
          >
            {hubSpotUpdates.pro_candidate}
          </Badge>
        }
      />
      <DataRow
        label="Verified Candidate"
        value={
          <Badge
            color={
              hubSpotUpdates.verified_candidates === 'Yes' ? 'green' : 'orange'
            }
          >
            {hubSpotUpdates.verified_candidates}
          </Badge>
        }
      />
      <DataRow
        label="Date Verified"
        value={formatTimestampString(hubSpotUpdates.date_verified)}
      />
    </InfoCard>
  )
}
