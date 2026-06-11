'use client'

import { useEffect } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { CAMPAIGN_QUERY_KEY } from '@shared/hooks/CampaignProvider'

// Onboarding flips campaign.isActive server-side right before the success page
// mounts. This component invalidates the client cache so the dashboard picks up
// the active campaign without a manual refresh.
export default function InvalidateCampaignOnMount(): null {
  const queryClient = useQueryClient()
  useEffect(() => {
    void queryClient.invalidateQueries({ queryKey: CAMPAIGN_QUERY_KEY })
  }, [queryClient])
  return null
}
